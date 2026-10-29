/** Reading the server's address as people type it: "localhost:8787", "opti2.tail1234.ts.net", "http://10.0.0.2:8787/". */

export type NormalizedUrl = { ok: true; url: string; origin: string } | { ok: false; message: string };

/**
 * Turns what was typed into the address the app opens: http(s) only, no sign-in in it, no query or fragment, and no
 * trailing slash (a path is kept, for a server behind a proxy at /pocket). A missing scheme means http on a
 * loopback or private address and https elsewhere, as a tunnel or Tailscale Serve name is https.
 */
export function normalizeServerUrl(input: string): NormalizedUrl {
    const text = input.trim();

    if (text === "") {
        return { ok: false, message: "Type the server's address" };
    }

    let url: URL;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${guessScheme(text)}://${text}`;

    try {
        url = new URL(withScheme);
    } catch {
        return { ok: false, message: "That is not an address" };
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, message: "The address must start with http:// or https://" };
    }

    if (url.username !== "" || url.password !== "") {
        return { ok: false, message: "Leave the sign-in out of the address; sign in in Pi Pocket instead" };
    }

    if (url.hostname === "") {
        return { ok: false, message: "The address needs a host" };
    }

    const path = url.pathname.replace(/\/+$/, "");

    return { ok: true, url: `${url.origin}${path}`, origin: url.origin };
}

function guessScheme(text: string): "http" | "https" {
    const host = text.split(/[/:]/, 1)[0]?.toLowerCase() ?? "";

    if (
        host === "localhost" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.startsWith("[") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        !host.includes(".")
    ) {
        return "http";
    }

    return "https";
}

/** The address of a path on the server, kept under the server's own path. */
export function serverPath(base: string, path: string): string {
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}
