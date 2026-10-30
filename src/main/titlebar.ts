/**
 * The seamless title bar: no bar of its own, Pi Pocket's page up to the window's top edge, and the window's controls
 * over it (macOS's traffic lights; on Windows and Linux, Electron's Window Controls Overlay).
 *
 * The page learns of the controls as a phone's page learns of its notch: a top safe-area inset
 * (env(safe-area-inset-top)), set through the DevTools protocol (Emulation.setSafeAreaInsetsOverride). Pi Pocket
 * already pads its top bar, rail, and sheets by that inset for phones, so its own surfaces, in its own colors, fill the
 * strip behind the controls. Nothing here knows Pi Pocket's markup: the only CSS added is a see-through strip of that
 * height to drag the window by.
 */
import type { BaseWindow, BaseWindowConstructorOptions, WebContents } from "electron";
import type { ThemeColors, TitleBarStyle } from "../shared/types";

/** The strip's height, in CSS pixels: room for the controls, centered in it. */
export const BAND = 36;

/** Where macOS's traffic lights sit in the strip: about 14 px tall, so centered at its middle. */
const TRAFFIC_LIGHTS = { x: 16, y: 11 };

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
        return { titleBarStyle: "hidden", trafficLightPosition: TRAFFIC_LIGHTS };
    }

    return { titleBarStyle: "hidden", titleBarOverlay: overlayColors(theme) };
}

/** Windows and Linux: the controls draw on the page's own ground (see-through), their symbols in its text color. */
export function overlayColors(theme: ThemeColors): { color: string; symbolColor: string; height: number } {
    return { color: "#00000000", symbolColor: theme.colors.text, height: BAND };
}

/**
 * The strip to drag the window by: as tall as the inset, so it goes with it (0 in full screen). Over everything, at
 * the top edge only, where the page has nothing of its own but the inset's padding.
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

export interface TitleBarHost {
    platform: string;
    style: TitleBarStyle;
    window: BaseWindow;
    /** The views that run to the top edge: their pages get the inset. */
    views: WebContents[];
    /** The server's page gets the drag strip as CSS; the app's own pages have it in their stylesheet. */
    server: WebContents;
}

export function setUpTitleBar(host: TitleBarHost): {
    /** How far down the views start: 0, unless the page could not be told of the inset (they then start below it). */
    offset: () => number;
    themeChanged: (theme: ThemeColors) => void;
} {
    if (host.style === "system") {
        return { offset: () => 0, themeChanged: () => undefined };
    }

    let failed = false;

    // In full screen the controls hide (macOS) or the strip has nothing to hold: the page takes the whole window.
    const inset = () => (host.window.isFullScreen() ? 0 : BAND);

    const tell = async (contents: WebContents): Promise<void> => {
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

    const tellAll = () => {
        for (const contents of host.views) {
            void tell(contents);
        }
    };

    for (const contents of host.views) {
        // A crashed page comes back without it; DevTools opening can take the protocol over for a moment.
        contents.on("render-process-gone", () => void tell(contents));
        contents.on("did-start-loading", () => void tell(contents));
        contents.debugger.on("detach", () => {
            setTimeout(() => void tell(contents), 500);
        });
    }

    host.server.on("dom-ready", () => {
        void host.server.insertCSS(DRAG_CSS).catch(() => undefined);
    });

    host.window.on("enter-full-screen", tellAll);
    host.window.on("leave-full-screen", tellAll);
    tellAll();

    return {
        offset: () => (failed ? inset() : 0),
        themeChanged: (theme) => {
            if (host.platform !== "darwin") {
                host.window.setTitleBarOverlay(overlayColors(theme));
            }
        },
    };
}
