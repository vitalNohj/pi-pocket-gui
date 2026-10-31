/**
 * The tray menu as data, and where its popup sits on the screen. Pure: no Electron, so the tests cover the items and
 * the on-screen clamping without a window. Windows draws this in a frameless popup (src/main/tray-popup.ts); other
 * desktops keep Electron's native menu.
 */
import type { PinnedSession, ThemeColors, TrayMenuStyle } from "../shared/types";
import { pinLabel } from "./bridge-input";

export type { TrayMenuStyle };

export interface TrayMenuAction {
    id: string;
    label: string;
    /** What a click does. The popup reports the id; the app runs the action. */
    run: () => void;
}

export interface TrayMenuItem {
    kind: "action";
    id: string;
    label: string;
    /** A pin's state mark (◆, ◐, …), drawn apart from the title. */
    mark?: string;
}

export interface TrayMenuHeader {
    kind: "header";
    label: string;
}

export interface TrayMenuSeparator {
    kind: "separator";
}

export type TrayMenuRow = TrayMenuItem | TrayMenuHeader | TrayMenuSeparator;

export interface TrayMenuModel {
    rows: TrayMenuRow[];
    /** Actions by id, in menu order. Headers and separators are not here. */
    actions: TrayMenuAction[];
}

/** What the tray shows now. */
export interface TrayMenuInput {
    /** Sessions that need you, for the "Open Pi Pocket" line. */
    badge: number;
    /** The app's own update, or this computer's Pi Pocket waiting to restart. */
    update: { label: string; click: () => void } | undefined;
    pins: PinnedSession[];
    showWindow: () => void;
    openSettings: () => void;
    quit: () => void;
    openPin: (url: string) => void;
}

/**
 * The tray's items, in the order the native menu has always used: Open Pi Pocket (with the needs-you count), the
 * update when there is one, the pinned sessions, Server settings…, Quit.
 */
export function buildTrayMenu(input: TrayMenuInput): TrayMenuModel {
    const open: TrayMenuAction = {
        id: "open",
        label: input.badge > 0 ? `Open Pi Pocket  (${input.badge} need you)` : "Open Pi Pocket",
        run: input.showWindow,
    };
    const update: TrayMenuAction | undefined =
        input.update === undefined ? undefined : { id: "update", label: input.update.label, run: input.update.click };
    const pins: TrayMenuAction[] = input.pins.map((pin) => ({
        id: `pin-${pin.id}`,
        label: pinLabel(pin),
        run: () => input.openPin(pin.url),
    }));
    const settings: TrayMenuAction = { id: "settings", label: "Server settings…", run: input.openSettings };
    const quit: TrayMenuAction = { id: "quit", label: "Quit", run: input.quit };
    const actions = [open, ...(update === undefined ? [] : [update]), ...pins, settings, quit];
    const rows: TrayMenuRow[] = [
        rowOf(open),
        ...(update === undefined ? [] : [rowOf(update)]),
        ...(pins.length > 0 ? [{ kind: "separator" as const }, { kind: "header" as const, label: "Pinned" }, ...pins.map(rowOf)] : []),
        { kind: "separator" },
        rowOf(settings),
        { kind: "separator" },
        rowOf(quit),
    ];

    return { rows, actions };
}

function rowOf(action: TrayMenuAction): TrayMenuItem {
    // A pin's label is "<mark>  <title>" (src/main/bridge-input.ts). The mark is one character, so a title that itself
    // holds two spaces stays whole. The title doubles every "&" so a native menu shows one; the popup has no
    // mnemonics, so it draws the title with the doubling undone.
    const mark = action.id.startsWith("pin-") ? action.label.slice(0, 1) : undefined;

    return {
        kind: "action",
        id: action.id,
        label: mark !== undefined ? action.label.slice(3).replace(/&&/g, "&") : action.label,
        ...(mark !== undefined ? { mark } : {}),
    };
}

/** A screen, in the same pixels as the popup. */
export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * One display. The tray icon lives on the taskbar, which is outside the work area, so the icon is matched against the
 * full bounds. The menu is then placed and clamped inside the work area, so it never slides under the taskbar.
 */
export interface TrayScreen {
    bounds: ScreenRect;
    workArea: ScreenRect;
}

/** Where the tray icon sits, and how big the menu is. */
export interface TrayAnchor {
    /** The icon's rectangle. On Windows the taskbar can be on any edge. */
    icon: ScreenRect;
    menu: { width: number; height: number };
    /** Every display the menu may sit on. */
    screens: TrayScreen[];
    /** A gap between the icon and the menu, so it does not cover the icon. */
    gap: number;
    /** How far the menu stays from a screen's edge. */
    margin: number;
}

/**
 * The popup's place: beside the icon, opening away from the screen edge the taskbar sits on, then clamped so the
 * whole menu stays on one screen. A menu taller than the screen is pinned to the top margin.
 */
export function placeTrayMenu(anchor: TrayAnchor): { x: number; y: number } {
    const display = screenOf(anchor.icon, anchor.screens) ?? anchor.screens[0];

    if (display === undefined) {
        return { x: anchor.icon.x, y: anchor.icon.y };
    }

    const screen = display.workArea;

    const { icon, menu, gap, margin } = anchor;
    const room = {
        above: icon.y - screen.y - gap - menu.height,
        below: screen.y + screen.height - (icon.y + icon.height) - gap - menu.height,
        left: icon.x - screen.x - gap - menu.width,
        right: screen.x + screen.width - (icon.x + icon.width) - gap - menu.width,
    };
    // The first edge the menu fits on wins, so a taskbar at the bottom opens it above the icon. Only when it fits on
    // none of them does it take the edge with the most room.
    const fitting = (["above", "below", "left", "right"] as const).find((each) => room[each] >= 0);
    const edge = fitting ?? (["above", "below", "left", "right"] as const).reduce((best, each) => (room[each] > room[best] ? each : best));
    let x = icon.x;
    let y = icon.y;

    if (edge === "below") {
        y = icon.y + icon.height + gap;
    } else if (edge === "above") {
        y = icon.y - gap - menu.height;
    } else if (edge === "right") {
        x = icon.x + icon.width + gap;
        y = icon.y + icon.height - menu.height;
    } else {
        x = icon.x - gap - menu.width;
        y = icon.y + icon.height - menu.height;
    }

    const minX = screen.x + margin;
    const minY = screen.y + margin;
    const maxX = screen.x + screen.width - margin - menu.width;
    const maxY = screen.y + screen.height - margin - menu.height;

    return {
        x: Math.round(clamp(x, minX, Math.max(minX, maxX))),
        y: Math.round(clamp(y, minY, Math.max(minY, maxY))),
    };
}

function screenOf(icon: ScreenRect, screens: TrayScreen[]): TrayScreen | undefined {
    const cx = icon.x + icon.width / 2;
    const cy = icon.y + icon.height / 2;

    return screens.find(({ bounds }) => cx >= bounds.x && cx < bounds.x + bounds.width && cy >= bounds.y && cy < bounds.y + bounds.height);
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Colors the popup paints. Windows' own, or Pi Pocket's. */
export interface TrayMenuPalette {
    style: TrayMenuStyle;
    mode: "light" | "dark";
    menu: string;
    text: string;
    muted: string;
    hover: string;
    hair: string;
    /** Windows' accent, used only for the keyboard focus, as Windows itself does. */
    accent: string;
    /** Pi Pocket's card radius; Windows uses its own. */
    radius: number;
    font: string;
}

/** Windows 11's menu colors, light and dark, as the shell paints them. */
const WINDOWS: Record<"light" | "dark", Omit<TrayMenuPalette, "style" | "mode" | "accent">> = {
    light: {
        menu: "#f9f9f9",
        text: "#1a1a1a",
        muted: "#5c5c5c",
        hover: "#ebebeb",
        hair: "#e5e5e5",
        radius: 8,
        font: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    },
    dark: {
        menu: "#2c2c2c",
        text: "#ffffff",
        muted: "#adadad",
        hover: "#3a3a3a",
        hair: "#3d3d3d",
        radius: 8,
        font: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
    },
};

/**
 * The popup's colors. "windows" follows the Windows app theme. "theme" follows Pi Pocket: the same surfaces as its
 * session menu (the panel, the text, a faint header, a hairline, a soft hover).
 */
export function trayMenuPalette(style: TrayMenuStyle, windowsDark: boolean, theme: ThemeColors, accent: string): TrayMenuPalette {
    if (style === "windows") {
        return { style, mode: windowsDark ? "dark" : "light", accent, ...WINDOWS[windowsDark ? "dark" : "light"] };
    }

    const { colors } = theme;

    return {
        style,
        mode: theme.mode,
        menu: colors.bg,
        text: colors.text,
        muted: colors.muted,
        hover: mix(colors.body, colors.bg, 0.07),
        hair: mix(colors.body, colors.bg, 0.1),
        accent,
        radius: 8,
        font: "Geist, system-ui, sans-serif",
    };
}

/** Mix a color into another by a fraction, the way Pi Pocket's `--hover` and `--hair` do. */
function mix(ink: string, surface: string, fraction: number): string {
    const a = rgb(ink);
    const b = rgb(surface);
    const channel = (index: number) => Math.round(a[index]! * fraction + b[index]! * (1 - fraction));

    return `#${[channel(0), channel(1), channel(2)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string): [number, number, number] {
    const value = hex.replace("#", "").slice(0, 6);

    return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/**
 * Electron reports the accent as RRGGBBAA (systemPreferences.getAccentColor), eight hex digits with the alpha last.
 * Anything else falls back to the accent Windows 11 uses.
 */
export function readAccent(value: unknown): string {
    if (typeof value !== "string") {
        return "#0067c0";
    }

    const hex = value.replace("#", "");
    const rgb = hex.length === 8 ? hex.slice(0, 6) : hex.length === 6 ? hex : undefined;

    return rgb !== undefined && /^[0-9a-f]{6}$/i.test(rgb) ? `#${rgb.toLowerCase()}` : "#0067c0";
}
