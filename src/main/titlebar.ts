/**
 * The seamless title bar: no bar of its own, Pi Pocket's page up to the window's top edge, and the window's controls
 * over it (macOS's traffic lights; on Windows and Linux, the minimize, maximize, and close buttons).
 *
 * The page learns where the controls are through the Window Controls Overlay, the web's standard for it
 * (navigator.windowControlsOverlay, env(titlebar-area-*)), on every platform. A Pi Pocket that knows it
 * (web/window-controls.js there) makes room only under the controls: the window under them, by as much as they take.
 * It says so on its root (data-window-controls), and then the page gets nothing more.
 *
 * A page that does not (an older Pi Pocket, a sign-in page in front of the server) is told of a band as a phone's page
 * is told of its notch: a top safe-area inset, set through the DevTools protocol (Emulation.setSafeAreaInsetsOverride).
 * Pi Pocket has long padded its bars by that inset, so its surfaces fill the band in its own colors; the only CSS added
 * is a see-through strip of that height to drag the window by.
 */
import type { BaseWindow, BaseWindowConstructorOptions, WebContents } from "electron";
import type { ThemeColors, TitleBarStyle } from "../shared/types";

/** Where macOS's traffic lights sit: close to the corner, so the band they need is short (their 14 px, and 7 on each side). */
export const TRAFFIC_LIGHTS = { x: 12, y: 7 };

/** The controls' height on Windows and Linux, in CSS pixels: as short as they stay easy to hit. */
export const OVERLAY_HEIGHT = 32;

/** The band a page that makes no room of its own is told of: the controls' height. */
export function bandHeight(platform: string): number {
    return platform === "darwin" ? 14 + 2 * TRAFFIC_LIGHTS.y : OVERLAY_HEIGHT;
}

/** The window's options for its title bar, fixed when the window is made. */
export function titleBarOptions(
    platform: string,
    style: TitleBarStyle,
    theme: ThemeColors,
): Pick<BaseWindowConstructorOptions, "titleBarStyle" | "titleBarOverlay" | "trafficLightPosition"> {
    if (style === "system") {
        return {};
    }

    if (platform === "darwin") {
        // The overlay itself: macOS draws the traffic lights; Electron tells the page where they are.
        return { titleBarStyle: "hidden", trafficLightPosition: TRAFFIC_LIGHTS, titleBarOverlay: true };
    }

    return { titleBarStyle: "hidden", titleBarOverlay: overlayColors(theme) };
}

/** Windows and Linux: the controls draw on the page's own ground (see-through), their symbols in its text color. */
export function overlayColors(theme: ThemeColors): { color: string; symbolColor: string; height: number } {
    return { color: "#00000000", symbolColor: theme.colors.text, height: OVERLAY_HEIGHT };
}

/**
 * For a page that makes no room of its own: the strip to drag the window by, as tall as the band it is told of (0
 * when it is told of none). Over everything, at the top edge only, where such a page has only the band's padding.
 */
export const DRAG_CSS = `:root::after {
    content: "";
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: env(safe-area-inset-top, 0px);
    -webkit-app-region: drag;
    app-region: drag;
    z-index: 2147483647;
}`;

/**
 * Windows paints minimize/maximize hover as a faint tint of black or white picked by the app's native theme, not by
 * symbolColor (Electron's win_caption_button.cc). With the system in light mode that is black on Pi Pocket's dark bar:
 * invisible. The caption buttons need the native theme to match the page's mode; nothing else does on Windows.
 */
export function captionScheme(platform: string, style: TitleBarStyle, theme: ThemeColors): "dark" | "light" | undefined {
    return platform === "win32" && style === "seamless" ? theme.mode : undefined;
}

/** `reg query ... /v AppsUseLightTheme` output: 0 is dark. Missing or unreadable is Windows' default, light. */
export function parseAppsUseLightTheme(output: string): "dark" | "light" {
    return /AppsUseLightTheme\s+REG_DWORD\s+0x0+\b/i.test(output) ? "dark" : "light";
}

/** How far the notch stays clear of the controls, in CSS pixels. */
export const NOTCH_GAP = 6;

/** The notch's corner: rounder than a square cut, sharper than a quarter circle. */
export const NOTCH_SHAPE = "superellipse(-5)";

/**
 * For a page that makes room for the controls itself (Pi Pocket's web/window-controls.js): tiled, the window whose bar
 * runs under the controls has its border, and its focus ring, cut around them instead of through them. Its corner on
 * the controls' side becomes a notch as deep and as wide as the controls reach into it, plus a small gap.
 *
 * Only what that page documents for desktop apps decides where: data-window-controls on its root ("left" on macOS,
 * "right" on Windows and Linux) and data-under-controls="bar" on the bar under them. Their size is the overlay's
 * (env(titlebar-area-*)). A page without those marks, a window without a bar under the controls (it starts below
 * them), or a Chromium without corner-shape keeps its corner as it was.
 */
export const NOTCH_CSS = `@supports (corner-shape: notch) {
    :root[data-tiling="on"][data-window-controls="right"] .layout > :has([data-under-controls="bar"]) {
        border-top-right-radius:
            calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) - var(--gap-out, 8px) + ${NOTCH_GAP}px)
            calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 0px) - var(--gap-out, 8px) + ${NOTCH_GAP}px);
        corner-top-right-shape: ${NOTCH_SHAPE};
    }

    :root[data-tiling="on"][data-window-controls="left"] .layout > :has([data-under-controls="bar"]) {
        border-top-left-radius:
            calc(env(titlebar-area-x, 0px) - var(--gap-out, 8px) + ${NOTCH_GAP}px)
            calc(env(titlebar-area-y, 0px) + env(titlebar-area-height, 0px) - var(--gap-out, 8px) + ${NOTCH_GAP}px);
        corner-top-left-shape: ${NOTCH_SHAPE};
    }
}`;

/** Whether the page makes room for the controls itself: Pi Pocket's web/window-controls.js marks its root. */
const OWN_ROOM = `document.documentElement.hasAttribute("data-window-controls")`;

export interface TitleBarHost {
    platform: string;
    style: TitleBarStyle;
    window: BaseWindow;
    /** The server's view: its page is told of the band, unless it makes room itself. */
    server: WebContents;
    theme: ThemeColors;
    /** Electron's nativeTheme (only its themeSource is set). */
    nativeTheme?: { themeSource: "system" | "dark" | "light" };
    /** The system's own light or dark for apps, unaffected by nativeTheme.themeSource. */
    systemScheme?: () => Promise<"dark" | "light">;
}

/**
 * nativeTheme.themeSource is process-wide: it also sets prefers-color-scheme in every page. It is forced to Pi Pocket's
 * mode (for the caption buttons) only while every server page is known to be given the system's scheme instead;
 * otherwise it stays "system", so a page never sees the wrong scheme.
 */
export class SchemeGuard {
    private readonly pages = new Map<WebContents, boolean>();
    /** Pages already gone: a check that finishes after one closed must not add it back (and block the override). */
    private readonly gone = new WeakSet<WebContents>();
    private system: "dark" | "light" | undefined;
    private wanted: "dark" | "light" | undefined;

    constructor(private readonly native: { themeSource: "system" | "dark" | "light" } | undefined) {}

    /** The system's scheme, which every page keeps seeing; undefined until read. */
    get systemScheme(): "dark" | "light" | undefined {
        return this.system;
    }

    setSystem(scheme: "dark" | "light"): void {
        this.system = scheme;
        this.apply();
    }

    /** The caption buttons' scheme, or undefined to leave nativeTheme alone. */
    want(scheme: "dark" | "light" | undefined): void {
        this.wanted = scheme;
        this.apply();
    }

    /** Whether this page is now given the system's scheme. A page not compensated keeps the override off. */
    mark(page: WebContents, compensated: boolean): void {
        if (this.gone.has(page)) {
            return;
        }

        this.pages.set(page, compensated);
        this.apply();
    }

    forget(page: WebContents): void {
        this.gone.add(page);
        this.pages.delete(page);
        this.apply();
    }

    private apply(): void {
        if (this.native === undefined || this.wanted === undefined) {
            return;
        }

        const safe = this.system !== undefined && [...this.pages.values()].every(Boolean);
        const next = safe ? this.wanted : "system";

        if (this.native.themeSource !== next) {
            this.native.themeSource = next;
        }
    }
}

export function setUpTitleBar(host: TitleBarHost): {
    /** How far down the server's view starts: 0, unless its page could not be told of the band. */
    offset: () => number;
    themeChanged: (theme: ThemeColors) => void;
    /** Another server page (a window it opened): give it the system's scheme before it loads. */
    followSystemScheme: (page: WebContents) => Promise<void>;
} {
    if (host.style === "system") {
        return { offset: () => 0, themeChanged: () => undefined, followSystemScheme: async () => undefined };
    }

    const contents = host.server;
    const band = bandHeight(host.platform);
    let failed = false;
    let theme = host.theme;
    const guard = new SchemeGuard(host.nativeTheme);
    const caption = () => captionScheme(host.platform, host.style, theme);

    /** Give a page the system's scheme over the debugger; until that succeeds, the guard keeps the override off. */
    const emulate = async (page: WebContents): Promise<void> => {
        const scheme = guard.systemScheme;

        if (caption() === undefined || page.isDestroyed()) {
            return;
        }

        if (scheme === undefined) {
            guard.mark(page, false);

            return;
        }

        try {
            if (!page.debugger.isAttached()) {
                page.debugger.attach("1.3");
            }

            // A page with nothing loaded yet may not answer: the override stays off rather than wait forever.
            await Promise.race([
                page.debugger.sendCommand("Emulation.setEmulatedMedia", {
                    features: [{ name: "prefers-color-scheme", value: scheme }],
                }),
                new Promise((_done, fail) => setTimeout(() => fail(new Error("timeout")), 3000)),
            ]);
            guard.mark(page, !page.isDestroyed() && page.debugger.isAttached() && guard.systemScheme === scheme);
        } catch {
            guard.mark(page, false);
        }
    };

    const follow = (page: WebContents): void => {
        guard.mark(page, false);
        page.once("destroyed", () => guard.forget(page));
        // Emulation lasts only while attached: off at once on detach, back once given again.
        page.debugger.on("detach", () => {
            guard.mark(page, false);
            setTimeout(() => void emulate(page), 500);
        });
        page.on("render-process-gone", () => {
            guard.mark(page, false);
            void emulate(page);
        });
    };
    /** Whether the page now shown makes its own room. Kept across loads of the same origin: the next one likely does too. */
    let ownRoom = false;
    let origin = "";

    // In full screen the controls hide (macOS) or there is nothing to keep clear of: the page takes the whole window.
    const inset = () => (ownRoom || host.window.isFullScreen() ? 0 : band);

    const tell = async (): Promise<void> => {
        if (contents.isDestroyed()) {
            return;
        }

        try {
            if (!contents.debugger.isAttached()) {
                contents.debugger.attach("1.3");
            }

            await contents.debugger.sendCommand("Emulation.setSafeAreaInsetsOverride", { insets: { top: inset() } });
        } catch (error) {
            if (!failed) {
                failed = true;
                console.error(`The page could not be told of the title bar (${(error as Error).message}); it starts below it.`);
                host.window.emit("resize");
            }
        }
    };

    const check = async (): Promise<void> => {
        let own = false;

        try {
            own = (await contents.executeJavaScript(OWN_ROOM, false)) === true;
        } catch {
            own = false;
        }

        if (own !== ownRoom) {
            ownRoom = own;
            void tell();
            host.window.emit("resize");
        }
    };

    contents.on("did-start-navigation", (details) => {
        if (!details.isMainFrame || details.isSameDocument) {
            return;
        }

        let next = "";

        try {
            next = new URL(details.url).origin;
        } catch {
            next = "";
        }

        // Another site (a sign-in page): told of the band until it shows that it makes its own room.
        if (next !== origin) {
            origin = next;
            ownRoom = false;
        }

        void tell();
    });

    // A module script runs before DOMContentLoaded, so the mark is there by then; checked again once it all loads.
    contents.on("dom-ready", () => {
        void contents.insertCSS(DRAG_CSS).catch(() => undefined);
        void contents.insertCSS(NOTCH_CSS).catch(() => undefined);
        void check();
    });
    contents.on("did-finish-load", () => void check());
    // A crashed page comes back without the override; DevTools opening can take the protocol over for a moment.
    contents.on("render-process-gone", () => void tell());
    contents.debugger.on("detach", () => {
        setTimeout(() => void tell(), 500);
    });

    host.window.on("enter-full-screen", () => void tell());
    host.window.on("leave-full-screen", () => void tell());

    // The system's setting can change while the app runs: read it again when the window comes back to the front.
    const readSystem = async () => {
        if (caption() === undefined || host.systemScheme === undefined) {
            return;
        }

        const next = await host.systemScheme().catch(() => guard.systemScheme ?? "light");

        if (next !== guard.systemScheme) {
            // Off until every page is given the new scheme.
            for (const page of pages) {
                guard.mark(page, false);
            }

            guard.setSystem(next);
            await Promise.all([...pages].map(emulate));
        }
    };
    const pages = new Set<WebContents>([contents]);

    if (caption() !== undefined) {
        follow(contents);
        contents.once("destroyed", () => pages.delete(contents));
    }

    guard.want(caption());
    host.window.on("focus", () => void readSystem());
    void readSystem();
    void tell();

    return {
        offset: () => (failed && !ownRoom ? inset() : 0),
        themeChanged: (next) => {
            theme = next;

            if (host.platform !== "darwin") {
                host.window.setTitleBarOverlay(overlayColors(next));
            }

            guard.want(caption());
        },
        followSystemScheme: async (page) => {
            if (caption() === undefined) {
                return;
            }

            pages.add(page);
            page.once("destroyed", () => pages.delete(page));
            follow(page);
            // Given again once its first document starts, in case the protocol did not answer before it had one.
            page.once("did-start-navigation", () => void emulate(page));
            await emulate(page);
        },
    };
}
