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

/** Whether the page makes room for the controls itself: Pi Pocket's web/window-controls.js marks its root. */
const OWN_ROOM = `document.documentElement.hasAttribute("data-window-controls")`;

export interface TitleBarHost {
    platform: string;
    style: TitleBarStyle;
    window: BaseWindow;
    /** The server's view: its page is told of the band, unless it makes room itself. */
    server: WebContents;
}

export function setUpTitleBar(host: TitleBarHost): {
    /** How far down the server's view starts: 0, unless its page could not be told of the band. */
    offset: () => number;
    themeChanged: (theme: ThemeColors) => void;
} {
    if (host.style === "system") {
        return { offset: () => 0, themeChanged: () => undefined };
    }

    const contents = host.server;
    const band = bandHeight(host.platform);
    let failed = false;
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
    void tell();

    return {
        offset: () => (failed && !ownRoom ? inset() : 0),
        themeChanged: (theme) => {
            if (host.platform !== "darwin") {
                host.window.setTitleBarOverlay(overlayColors(theme));
            }
        },
    };
}
