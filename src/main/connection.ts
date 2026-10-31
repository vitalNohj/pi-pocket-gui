/** Connection decisions shared by the IPC boundary and its tests, independent of Electron. */
import type { ProbeResult } from "../shared/types";

/** Detection is required, except for an HTML/sign-in page the person has explicitly chosen to open. */
export function mayConnect(result: ProbeResult, allowUnverified = false): boolean {
    return result.kind === "detected" || (allowUnverified && result.kind === "other" && result.canOpen);
}

/**
 * Correlate response headers with committed documents. Downloads have headers but no commit; their metadata is
 * discarded at the next navigation instead of tearing down the still-loaded page and hiding its Back button.
 */
export class NavigationResponses {
    private readonly types = new Map<string, string>();

    started(): void {
        this.types.clear();
    }

    received(url: string, contentType: string): void {
        this.types.set(url.split("#")[0]!, contentType);
    }

    committed(url: string, status: number, unverified = false): string | undefined {
        const type = this.types.get(url.split("#")[0]!) ?? "";

        this.types.clear();

        return pageProblem(status, type, unverified);
    }
}

/** A navigation can fail without did-fail-load: HTTP errors and Chromium’s JSON viewer are successful loads. */
export function pageProblem(status: number, contentType: string, unverified = false): string | undefined {
    if (status >= 300 && status < 400) {
        return undefined; // A redirect is not the final page.
    }

    const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    const html = type === "text/html" || type === "application/xhtml+xml";

    if (status >= 400 && !(unverified && html && (status === 401 || status === 403))) {
        return `The server returned HTTP ${String(status)} instead of Pi Pocket. Retry or check the web interface address.`;
    }

    if (type !== "" && !html) {
        return `The address returned ${type}, not the Pi Pocket webpage. Use the web interface address, not a model/API endpoint.`;
    }

    return undefined;
}
