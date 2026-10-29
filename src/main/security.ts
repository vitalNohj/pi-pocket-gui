/**
 * What the server's page may do: which origins it may load, which permissions it gets, and where other links open.
 * Everything not allowed here is refused. The rules are read from the current settings at each check, so a changed
 * address applies at once.
 */
import { shell, type Session, type WebContents } from "electron";

export interface OriginPolicy {
    /** The origins the window may show: the server's, and the extra ones from settings (a sign-in in front of it). */
    allowed(): Set<string>;
    /** The server's own origin: the only one that gets permissions and the bridge. */
    server(): string;
}

/** The permissions the server's page may have. The microphone is for dictation; nothing else is asked for. */
const SERVER_PERMISSIONS = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "fullscreen",
    "media",
    "notifications",
    "window-management",
]);

function originOf(url: string): string | undefined {
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}

/** Opens an address in the system browser, when it is http(s) or mailto. Anything else is dropped. */
export function openOutside(url: string): void {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return;
    }

    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        void shell.openExternal(parsed.toString());
    }
}

export function guardSession(session: Session, policy: OriginPolicy): void {
    session.setPermissionRequestHandler((contents, permission, callback, details) => {
        const origin = originOf(details.requestingUrl);
        const isMain = details.isMainFrame;

        if (origin !== policy.server() || !isMain || !SERVER_PERMISSIONS.has(permission)) {
            callback(false);

            return;
        }

        if (permission === "media") {
            const types = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];

            callback(types.length > 0 && types.every((type) => type === "audio"));

            return;
        }

        callback(true);
    });

    session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
        return originOf(requestingOrigin) === policy.server() && SERVER_PERMISSIONS.has(permission);
    });

    session.setDevicePermissionHandler(() => false);
    session.on("will-download", () => {
        // Electron asks where to save, as a browser does.
    });
}

/**
 * Navigation in the server's window stays on the allowed origins. A link elsewhere opens in the system browser; a
 * window the page opens goes to `openSameOrigin` for the server's own pages, and outside otherwise.
 */
export function guardContents(
    contents: WebContents,
    policy: OriginPolicy,
    openSameOrigin: (url: string) => void,
): void {
    const allowedNavigation = (url: string): boolean => {
        const origin = originOf(url);

        return origin !== undefined && policy.allowed().has(origin);
    };

    contents.on("will-navigate", (event) => {
        if (!allowedNavigation(event.url)) {
            event.preventDefault();
            openOutside(event.url);
        }
    });

    contents.on("will-redirect", (event) => {
        if (event.isMainFrame && !allowedNavigation(event.url)) {
            event.preventDefault();
            openOutside(event.url);
        }
    });

    contents.on("will-attach-webview", (event) => {
        event.preventDefault();
    });

    contents.setWindowOpenHandler(({ url }) => {
        if (originOf(url) === policy.server()) {
            openSameOrigin(url);
        } else {
            openOutside(url);
        }

        return { action: "deny" };
    });
}
