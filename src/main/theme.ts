/**
 * Pi Pocket's colors, as the server's page shows them now: the settings screen, the window's background, and the tray's
 * π take them, so the app looks like the Pi Pocket it opens. The server page's preload reads them (src/preload/
 * server.ts) and sends them whenever the theme changes; they are kept in theme.json, so the next start looks right
 * before the server answers. Until a server sends any, Pi Pocket's default (Tokyo Night) shows.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ThemeColors, ThemeToken } from "../shared/types";

/** The tokens the app takes, by Pi Pocket's names (docs/extensions/reference/theme-surface.md there). */
export const THEME_TOKENS: readonly ThemeToken[] = [
    "desk",
    "bg",
    "card",
    "text",
    "body",
    "muted",
    "accent",
    "accent-fill",
    "accent-ink",
    "brand",
    "ok",
    "warn",
    "err",
    "code-bg",
];

/** Pi Pocket's default look, Tokyo Night. */
export const DEFAULT_THEME: ThemeColors = {
    mode: "dark",
    colors: {
        desk: "#0e0e14",
        bg: "#1a1b26",
        card: "#202230",
        text: "#c0caf5",
        body: "#a9b1d6",
        muted: "#878ca9",
        accent: "#7aa2f7",
        "accent-fill": "#7aa2f7",
        "accent-ink": "#1a1b26",
        brand: "#eb927b",
        ok: "#9ece6a",
        warn: "#e0af68",
        err: "#f7768e",
        "code-bg": "#13141c",
    },
};

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;

/** The page's colors: every token as #rrggbb[aa], and readable on the app's surfaces. Otherwise dropped whole. */
export function readTheme(input: unknown): ThemeColors | undefined {
    if (typeof input !== "object" || input === null) {
        return undefined;
    }

    const { mode, colors } = input as { mode?: unknown; colors?: unknown };

    if ((mode !== "dark" && mode !== "light") || typeof colors !== "object" || colors === null) {
        return undefined;
    }

    const result = {} as Record<ThemeToken, string>;

    for (const token of THEME_TOKENS) {
        const value = (colors as Record<string, unknown>)[token];

        if (typeof value !== "string" || !HEX.test(value.toLowerCase())) {
            return undefined;
        }

        result[token] = value.toLowerCase();
    }

    // The grounds must be solid: the window paints them before any page does.
    for (const token of ["desk", "bg"] as const) {
        result[token] = result[token].slice(0, 7);
    }

    // A missing/invalid CSS variable can resolve to inherited black; a failed canvas read can give transparent
    // pixels. Neither is a usable palette, even though every value is valid hex. Check saved themes and IPC alike.
    // 1.5:1 is only a safety floor, not an accessibility audit; include alpha and the actual settings surfaces.
    const readable = (ink: ThemeToken, surface: ThemeToken): boolean =>
        contrast(result[ink], result[surface], result.bg) >= 1.5;

    for (const ink of ["text", "body", "muted", "accent", "brand", "ok", "warn", "err"] as const) {
        if (!(["desk", "bg", "card"] as const).every((surface) => readable(ink, surface))) {
            return undefined;
        }
    }

    if (!readable("text", "code-bg") || !readable("accent-ink", "accent-fill")) {
        return undefined;
    }

    return { mode, colors: result };
}

export function sameTheme(a: ThemeColors, b: ThemeColors): boolean {
    return a.mode === b.mode && THEME_TOKENS.every((token) => a.colors[token] === b.colors[token]);
}

export function loadTheme(path: string): ThemeColors {
    try {
        return readTheme(JSON.parse(readFileSync(path, "utf8")) as unknown) ?? DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
}

export function saveTheme(path: string, theme: ThemeColors): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${String(process.pid)}.tmp`;

        writeFileSync(temporary, `${JSON.stringify(theme, null, 4)}\n`);
        renameSync(temporary, path);
    } catch {
        // Only a look for the next start: without it, the default shows until the server sends its own.
    }
}

type Rgb = { r: number; g: number; b: number };

/** A token painted over the surface beneath it. */
function composite(hex: string, ground: Rgb): Rgb {
    const color = rgbOf(hex);
    const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1;

    return {
        r: color.r * alpha + ground.r * (1 - alpha),
        g: color.g * alpha + ground.g * (1 - alpha),
        b: color.b * alpha + ground.b * (1 - alpha),
    };
}

function luminance(color: Rgb): number {
    const linear = (channel: number): number => {
        const value = channel / 255;

        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };

    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function contrast(ink: string, surface: string, ground: string): number {
    const paper = composite(surface, rgbOf(ground));
    const a = luminance(composite(ink, paper));
    const b = luminance(paper);

    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** "#rrggbb" as numbers. */
export function rgbOf(hex: string): { r: number; g: number; b: number } {
    return {
        r: Number.parseInt(hex.slice(1, 3), 16),
        g: Number.parseInt(hex.slice(3, 5), 16),
        b: Number.parseInt(hex.slice(5, 7), 16),
    };
}
