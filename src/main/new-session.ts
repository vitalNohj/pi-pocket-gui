/**
 * New session from the operating system: the app menu's New Session (⌘N, Ctrl+N), the macOS dock's menu, the tray, and
 * a `pi-pocket://new` link. Each shows the window and, when the server's page can, asks it to open its New session
 * sheet (the bridge's `newSession` event, Pi Pocket's docs/desktop.md). The tray's item is in src/main/desktop.ts.
 *
 * The functions at the top are pure, for the tests; the ones below them hold the app's listeners.
 */
import { app, Menu, type MenuItemConstructorOptions } from "electron";

/** The links the app opens: `pi-pocket://new`. */
export const PROTOCOL = "pi-pocket";

/**
 * How long a New session waits for the server's page, when the page has not yet said what it handles: it is loading,
 * or the app was started by the link and has not connected yet. The window shows at once in any case.
 */
export const NEW_SESSION_WAIT_MS = 30_000;

/** What a link asks for: "new", a new session. Anything else is not a link of this app, or not one it knows. */
export function linkAction(value: string): "new" | undefined {
    let url: URL;

    try {
        url = new URL(value);
    } catch {
        return undefined;
    }

    if (url.protocol !== `${PROTOCOL}:`) {
        return undefined;
    }

    // pi-pocket://new, pi-pocket://new/ (as Windows passes it), and pi-pocket:new.
    const path = `${url.host}${url.pathname}`.replace(/^\/+|\/+$/g, "").toLowerCase();

    return path === "new" ? "new" : undefined;
}

/** The app's link among a command line's arguments: Windows and Linux start the app with it, or pass it on. */
export function linkInArgv(argv: readonly string[]): string | undefined {
    return argv.find((arg) => arg.toLowerCase().startsWith(`${PROTOCOL}:`));
}

/**
 * What New session does after the window shows:
 * - "send": the server's page shows and handles `newSession`: ask it to open the sheet.
 * - "show": nothing more. The settings screen shows, or the page is of an older Pi Pocket without `newSession`.
 * - "wait": the page has not said what it handles yet (it is loading, or not connected). Send once it does, if it
 *   handles `newSession` and shows by then.
 */
export function newSessionStep(input: {
    showingServer: boolean;
    /** The host events the page said it handles (`pocketHost.subscribe`); undefined until it subscribed. */
    pageEvents: ReadonlySet<string> | undefined;
}): "send" | "wait" | "show" {
    if (input.pageEvents === undefined) {
        return "wait";
    }

    if (!input.showingServer) {
        return "show";
    }

    return input.pageEvents.has("newSession") ? "send" : "show";
}

/** The event types a page said it handles, checked: the page is another program. */
export function readPageEvents(value: unknown): Set<string> {
    if (!Array.isArray(value)) {
        return new Set();
    }

    return new Set(
        value
            .slice(0, 100)
            .filter((each): each is string => typeof each === "string" && each.length <= 100),
    );
}

/**
 * ⌘N on macOS, Ctrl+N elsewhere, in the server's page: the app's, as ⌘, is, so a page's own keys never take it. The
 * menu's accelerator is the same key, for when the settings screen has the keyboard.
 */
export function isNewSessionKey(
    input: { type: string; key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean },
    platform: NodeJS.Platform,
): boolean {
    const mod = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta;

    return input.type === "keyDown" && input.key.toLowerCase() === "n" && mod && !input.alt && !input.shift;
}

/** The app menu's item: in the File menu. */
export function newSessionMenuItem(click: () => void): MenuItemConstructorOptions {
    return { label: "New Session", accelerator: "CommandOrControl+N", click };
}

let requested = false;
let handler: (() => void) | undefined;

function request(): void {
    if (handler !== undefined) {
        handler();
    } else {
        requested = true;
    }
}

/**
 * Hear the app's links. Call it as the app starts, before it is ready: macOS sends the link that started the app as an
 * `open-url` event that early. Windows and Linux start the app with it among the arguments, or, when the app already
 * runs, pass it to the running app (`second-instance`). What comes before `offerNewSession` waits for it.
 */
export function listenForNewSessionLinks(): void {
    app.on("open-url", (event, url) => {
        event.preventDefault();

        if (linkAction(url) === "new") {
            request();
        }
    });
    app.on("second-instance", (_event, argv) => {
        const link = linkInArgv(argv);

        if (link !== undefined && linkAction(link) === "new") {
            request();
        }
    });

    const first = linkInArgv(process.argv);

    if (first !== undefined && linkAction(first) === "new") {
        requested = true;
    }
}

/** The app is ready: the dock's menu, the link's registration, and a New session asked for before now. */
export function offerNewSession(newSession: (starting?: boolean) => void): void {
    handler = () => newSession();

    // Only an installed app: a development build would make itself every link's handler on the developer's computer.
    // The installers name the link too (package.json: protocols).
    if (app.isPackaged) {
        app.setAsDefaultProtocolClient(PROTOCOL);
    }

    app.dock?.setMenu(Menu.buildFromTemplate([{ label: "New Session", click: () => newSession() }]));

    // Asked for as the app started: it connects next, so the request waits for the page.
    if (requested) {
        requested = false;
        newSession(true);
    }
}
