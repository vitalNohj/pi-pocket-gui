/**
 * Is there a Pi Pocket at this address? First `GET /api/pocket/info`, which a server with the desktop bridge answers
 * without a sign-in ({ name: "pi-pocket", bridge: N }); else the web app manifest every Pi Pocket serves (bridge 0).
 */
import type { ProbeResult } from "../shared/types";
import { normalizeServerUrl, serverPath } from "./url";

export type Fetch = (url: string, init: { signal: AbortSignal; redirect: "follow" | "manual" }) => Promise<Response>;

export async function probe(input: string, fetcher: Fetch, timeoutMs: number): Promise<ProbeResult> {
    const normalized = normalizeServerUrl(input);

    if (!normalized.ok) {
        return { kind: "invalid", url: input, message: normalized.message };
    }

    const url = normalized.url;
    let info: Response;

    try {
        info = await fetchWithTimeout(fetcher, serverPath(url, "/api/pocket/info"), timeoutMs);
    } catch (error) {
        return { kind: "unreachable", url, message: networkMessage(error, timeoutMs) };
    }

    const fromInfo = await readJson(info);

    if (info.ok && isRecord(fromInfo) && fromInfo.name === "pi-pocket") {
        const bridge = typeof fromInfo.bridge === "number" && Number.isInteger(fromInfo.bridge) ? fromInfo.bridge : 0;

        return { kind: "detected", url, bridge, via: "info" };
    }

    let manifest: Response;

    try {
        manifest = await fetchWithTimeout(fetcher, serverPath(url, "/manifest.webmanifest"), timeoutMs);
    } catch (error) {
        return { kind: "unreachable", url, message: networkMessage(error, timeoutMs) };
    }

    const fromManifest = await readJson(manifest);

    if (manifest.ok && isRecord(fromManifest) && fromManifest.name === "Pi Pocket") {
        return { kind: "detected", url, bridge: 0, via: "manifest" };
    }

    const redirected = manifest.redirected || info.redirected;

    return {
        kind: "other",
        url,
        status: manifest.status,
        message: redirected
            ? "Something answered, but it sent the app to another page. A sign-in page in front of the server (such as Cloudflare Access) does this: open it anyway and sign in there."
            : `Something answered (HTTP ${String(manifest.status)}), but it does not look like Pi Pocket.`,
    };
}

async function fetchWithTimeout(fetcher: Fetch, url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new Error("timeout"));
    }, timeoutMs);

    try {
        return await fetcher(url, { signal: controller.signal, redirect: "follow" });
    } finally {
        clearTimeout(timer);
    }
}

async function readJson(response: Response): Promise<unknown> {
    try {
        const text = await response.text();

        return text.length > 64 * 1024 ? undefined : (JSON.parse(text) as unknown);
    } catch {
        return undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Chromium's and Node's network errors, in words. */
export function networkMessage(error: unknown, timeoutMs: number): string {
    const text = describeError(error);

    if (/timeout|aborted/i.test(text)) {
        return `No answer within ${String(Math.round(timeoutMs / 100) / 10)} s.`;
    }

    if (/ECONNREFUSED|CONNECTION_REFUSED/i.test(text)) {
        return "Nothing listens at that address and port.";
    }

    if (/ENOTFOUND|NAME_NOT_RESOLVED|EAI_AGAIN/i.test(text)) {
        return "That host name was not found.";
    }

    if (/CERT|SSL|TLS/i.test(text)) {
        return `The server's https certificate is not trusted (${text}).`;
    }

    if (/ADDRESS_UNREACHABLE|EHOSTUNREACH|ENETUNREACH|INTERNET_DISCONNECTED/i.test(text)) {
        return "That address cannot be reached from this computer.";
    }

    return text;
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;

        return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message;
    }

    return String(error);
}
