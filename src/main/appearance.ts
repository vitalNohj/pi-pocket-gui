/**
 * A see-through, blurred window. Each desktop does it its own way:
 *
 * - macOS: vibrancy, the system's blur under the window. It turns on and off at any time.
 * - Windows 11 (22H2 and newer): a backdrop material, acrylic or mica. It turns on and off at any time.
 * - Linux: a window is see-through only when it is made so, so turning it on takes a restart. The compositor blurs
 *   it with its own settings (Hyprland's `decoration:blur`, KWin's Blur effect); GNOME shows it see-through only.
 *
 * The window's own color and the views' backgrounds turn see-through, and the server's page gets a few lines of CSS
 * that let its grounds through. That CSS reads Pi Pocket's theme tokens (docs/extensions/reference/theme-surface.md
 * there): when a release renames them, the page only stays solid.
 */
import type { BaseWindow, WebContents, WebContentsView } from "electron";
import type { Settings, TranslucencySupport } from "../shared/types";

const CLEAR = "#00000000";

/** Windows 11 22H2, the first build with backdrop materials for apps. */
const FIRST_MATERIAL_BUILD = 22621;

/** What this desktop can do. `atStart`: the window was made see-through when it was made (Linux needs that). */
export function translucencySupport(platform: string, systemVersion: string, atStart: boolean): TranslucencySupport {
    switch (platform) {
        case "darwin":
            return { kind: "live", blur: "system" };
        case "win32": {
            const build = Number(systemVersion.split(".")[2] ?? 0);

            return build >= FIRST_MATERIAL_BUILD
                ? { kind: "live", blur: "system" }
                : { kind: "unsupported", message: "Needs Windows 11 (version 22H2 or newer)." };
        }
        case "linux":
            return atStart ? { kind: "live", blur: "compositor" } : { kind: "restart" };
        default:
            return { kind: "unsupported", message: "This system cannot show a see-through window." };
    }
}

/**
 * The CSS for the server's page. Unlayered, it wins over Pi Pocket's layered styles (`@layer pocket, palette,
 * theme`) and over a theme's. The grounds (`--bg`, `--panel`, the desk behind tiled windows) let the desktop through;
 * what floats over them (sheets, menus, the launcher) stays solid, and so do cards and text colors, which Pi Pocket
 * mixes on `:root` from the solid ground.
 */
export function pageCss(opacity: number): string {
    const ground = clamp(opacity);
    // The desk, in the gaps between tiled windows, lets more through than the windows do.
    const desk = Math.max(0, ground - 35);

    return `
:root {
    --gui-bg: var(--bg);
    --gui-panel: var(--panel);
    --gui-desk: var(--desk);
}
html {
    background: color-mix(in srgb, var(--gui-desk) ${String(desk)}%, transparent);
}
body {
    background: transparent;
    --bg: color-mix(in srgb, var(--gui-bg) ${String(ground)}%, transparent);
    --panel: color-mix(in srgb, var(--gui-panel) ${String(ground)}%, transparent);
}
.layout,
.boot {
    background-color: transparent;
}
.sheet,
.drawer,
.pop-menu,
.launcher,
.reaction-picker,
.mention-list,
.branch-picker,
.notice {
    --bg: var(--gui-bg);
    --panel: var(--gui-panel);
}
`;
}

function clamp(opacity: number): number {
    return Math.min(100, Math.max(0, Math.round(opacity)));
}

export interface AppearanceHost {
    platform: string;
    systemVersion: string;
    window: BaseWindow;
    views: WebContentsView[];
    /** The server's page, and whether it shows the server's own origin now (not a sign-in page in front of it). */
    server: WebContents;
    onServerOrigin: () => boolean;
    /** Linux: whether the window was made see-through at start. */
    translucentAtStart: boolean;
    /** The window's color when solid: Pi Pocket's ground in its theme now, so nothing flashes another color. */
    solid: () => string;
}

export function setUpAppearance(host: AppearanceHost): {
    support: () => TranslucencySupport;
    /** Apply the settings to the window and the views. */
    apply: (settings: Settings) => void;
    /** The server's page loaded: give it the CSS again (a load drops what was inserted). */
    pageLoaded: () => void;
    /** The theme's ground changed: the solid window takes it. */
    themeChanged: () => void;
} {
    const support = () => translucencySupport(host.platform, host.systemVersion, host.translucentAtStart);
    let current: Settings["appearance"] | undefined;
    let inserted: { key: string; css: string } | undefined;
    /** Inserting and removing CSS are asynchronous: one at a time, so a quick second change never inserts twice. */
    let queue: Promise<void> = Promise.resolve();

    const on = () => current?.translucent === true && support().kind === "live";

    function applyWindow(): void {
        const translucent = on();
        const color = translucent ? CLEAR : host.solid();

        if (host.platform === "darwin") {
            host.window.setVibrancy(translucent ? (current?.macMaterial ?? "under-window") : null);
        } else if (host.platform === "win32" && support().kind === "live") {
            host.window.setBackgroundMaterial(translucent ? (current?.windowsMaterial ?? "acrylic") : "none");
        }

        host.window.setBackgroundColor(color);

        for (const view of host.views) {
            view.setBackgroundColor(color);
        }
    }

    function applyPage(): void {
        queue = queue.then(syncPage, () => undefined);
    }

    async function syncPage(): Promise<void> {
        const contents = host.server;

        if (contents.isDestroyed()) {
            return;
        }

        const css = on() && host.onServerOrigin() ? pageCss(current?.opacity ?? 100) : undefined;

        if (inserted?.css === css) {
            return;
        }

        const old = inserted;

        inserted = undefined;

        try {
            // Insert the new before removing the old, so the page never flashes solid between two opacities.
            if (css !== undefined) {
                inserted = { key: await contents.insertCSS(css), css };
            }

            if (old !== undefined) {
                await contents.removeInsertedCSS(old.key);
            }
        } catch {
            // The page went away meanwhile; the next load applies it again.
        }
    }

    return {
        support,
        apply: (settings) => {
            current = settings.appearance;
            applyWindow();
            applyPage();
        },
        themeChanged: applyWindow,
        pageLoaded: () => {
            // A new document has none of what was inserted into the last one.
            queue = queue.then(() => {
                inserted = undefined;
            });
            applyPage();
        },
    };
}
