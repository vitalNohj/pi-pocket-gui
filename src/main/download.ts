/**
 * A file downloaded to a folder, checked against the SHA-256 GitHub gives for it, and kept under its name only once it
 * is whole and checked: a half-finished or wrong download never takes the name.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { safeFileName } from "./update-pick";

export interface DownloadRequest {
    url: string;
    name: string;
    folder: string;
    /** Hex SHA-256; without one the download is kept unchecked. */
    sha256?: string;
    /** The size GitHub says, for progress when the response has no length. */
    size?: number;
    fetch: (url: string) => Promise<Response>;
    onProgress?: (percent: number) => void;
    /** Bytes as they arrive, for progress over several files. */
    onBytes?: (received: number) => void;
    /** Stops the download; the part already written is removed. */
    signal?: AbortSignal;
}

/** Downloads, checks, and returns the file's path. Throws on a failed request or a wrong checksum. */
export async function downloadChecked(request: DownloadRequest): Promise<string> {
    const target = join(request.folder, safeFileName(request.name));
    const partial = `${target}.part`;
    const response = await request.fetch(request.url);

    if (!response.ok || response.body === null) {
        throw new Error(`The download failed (HTTP ${response.status}).`);
    }

    const total = Number(response.headers.get("content-length")) || request.size || 0;
    const hash = createHash("sha256");
    const out = createWriteStream(partial);
    let received = 0;
    let reported = -1;

    try {
        const reader = response.body.getReader();

        for (;;) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            if (request.signal?.aborted === true) {
                await reader.cancel();
                throw new Error("The download was cancelled.");
            }

            hash.update(value);
            received += value.length;
            request.onBytes?.(received);

            if (!out.write(value)) {
                await new Promise<void>((resolve) => out.once("drain", resolve));
            }

            if (total > 0) {
                const percent = Math.min(100, Math.floor((received / total) * 100));

                if (percent !== reported) {
                    reported = percent;
                    request.onProgress?.(percent);
                }
            }
        }

        await new Promise<void>((resolve, reject) => {
            out.end((error?: Error | null) => (error ? reject(error) : resolve()));
        });

        const digest = hash.digest("hex");

        if (request.sha256 !== undefined && digest !== request.sha256.toLowerCase()) {
            throw new Error("The download does not match its checksum, so it was thrown away.");
        }

        await rename(partial, target);

        return target;
    } catch (error) {
        out.destroy();
        await rm(partial, { force: true });

        throw error;
    }
}
