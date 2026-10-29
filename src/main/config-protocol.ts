/**
 * The app's own pages, at pocket-gui://app/…: the config screen and its files, from dist/renderer/config. Nothing
 * outside that folder is served, and each page gets a strict Content-Security-Policy.
 */
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { protocol, type Session } from "electron";

export const APP_SCHEME = "pocket-gui";
export const APP_ORIGIN = `${APP_SCHEME}://app`;
export const CONFIG_URL = `${APP_ORIGIN}/config/index.html`;

const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".map": "application/json",
};

const CSP =
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Must run before the app is ready. */
export function registerAppScheme(): void {
    protocol.registerSchemesAsPrivileged([
        { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: false } },
    ]);
}

export function serveAppPages(session: Session, rendererRoot: string): void {
    const root = normalize(rendererRoot);

    session.protocol.handle(APP_SCHEME, async (request) => {
        const url = new URL(request.url);

        if (url.host !== "app" || request.method !== "GET") {
            return new Response("Not found", { status: 404 });
        }

        const file = normalize(join(root, decodeURIComponent(url.pathname)));

        if (!file.startsWith(root + sep)) {
            return new Response("Not found", { status: 404 });
        }

        try {
            const body = await readFile(file);

            return new Response(body, {
                headers: {
                    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
                    "content-security-policy": CSP,
                    "x-content-type-options": "nosniff",
                    "cache-control": "no-store",
                },
            });
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });
}
