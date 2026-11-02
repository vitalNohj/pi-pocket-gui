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

/** What New session finds as the window shows. */
export interface NewSessionView {
    /** The server view shows, not the settings screen. */
    showingServer: boolean;
    /** The server view has a server's page loaded, or loading. */
    serverLoaded: boolean;
    /** The host events the page said it handles (`pocketHost.subscribe`); undefined until it subscribed. */
    pageEvents: ReadonlySet<string> | undefined;
}

/**
 * What New session does after the window shows:
 * - "send": the server's page shows and handles `newSession`: ask it to open the sheet.
 * - "show": nothing more. The settings screen shows, no server is loaded, or the page is of an older Pi Pocket without
 *   `newSession`. A request made on the settings screen never waits: the person asked there, not on the server.
 * - "wait": the server's page shows but has not said what it handles yet (it is loading). Send once it does, if it
 *   handles `newSession` and still shows. `starting`: the app was started for the request (a link) and connects
 *   next, so it waits also on the settings screen the app starts with.
 */
export function newSessionStep(view: NewSessionView, starting = false): "send" | "wait" | "show" {
    if (starting && view.pageEvents === undefined) {
        return "wait";
    }

    if (!view.showingServer || !view.serverLoaded) {
        return "show";
    }

    if (view.pageEvents === undefined) {
        return "wait";
    }

    return view.pageEvents.has("newSession") ? "send" : "show";
}

/** The timers a pending request uses; the tests give their own. */
export interface NewSessionTimers {
    set: (run: () => void, ms: number) => unknown;
    clear: (timer: unknown) => void;
}

/**
 * The New session request that waits for the page (at most one). It ends when the page subscribes (it sends then, if
 * it can), after `NEW_SESSION_WAIT_MS`, or when the window changes from the server to the settings screen: a request
 * never opens the sheet after the person went to the settings.
 */
export class PendingNewSession {
    readonly #send: () => void;
    readonly #timers: NewSessionTimers;
    readonly #waitMs: number;
    #timer: unknown;
    #waiting = false;
    #showingServer: boolean | undefined;

    constructor(
        send: () => void,
        timers: NewSessionTimers = { set: (run, ms) => setTimeout(run, ms), clear: (timer) => clearTimeout(timer as NodeJS.Timeout) },
        waitMs = NEW_SESSION_WAIT_MS,
    ) {
        this.#send = send;
        this.#timers = timers;
        this.#waitMs = waitMs;
    }

    get waiting(): boolean {
        return this.#waiting;
    }

    /** A New session, after the window shows. */
    request(view: NewSessionView, starting = false): void {
        this.#showingServer = view.showingServer;
        this.#next(newSessionStep(view, starting));
    }

    /** The page subscribed and named its events: a waiting request goes on. */
    pageSubscribed(view: NewSessionView): void {
        this.#showingServer = view.showingServer;

        if (this.#waiting) {
            this.#next(newSessionStep(view));
        }
    }

    /** The window shows the server view or the settings screen (again). */
    screenChanged(showingServer: boolean): void {
        const left = this.#showingServer === true && !showingServer;

        this.#showingServer = showingServer;

        if (left) {
            this.cancel();
        }
    }

    cancel(): void {
        if (this.#waiting) {
            this.#timers.clear(this.#timer);
            this.#waiting = false;
            this.#timer = undefined;
        }
    }

    #next(step: "send" | "wait" | "show"): void {
        this.cancel();

        if (step === "wait") {
            this.#waiting = true;
            this.#timer = this.#timers.set(() => this.cancel(), this.#waitMs);
        } else if (step === "send") {
            this.#send();
        }
    }
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
