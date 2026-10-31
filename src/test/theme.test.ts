import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tint } from "../main/badge-image";
import { DEFAULT_THEME, loadTheme, readTheme, saveTheme, THEME_TOKENS } from "../main/theme";

const gruvbox = {
    mode: "dark",
    colors: {
        ...Object.fromEntries(THEME_TOKENS.map((token) => [token, "#D79921"])),
        desk: "#282828",
        bg: "#282828",
        card: "#32302f",
        "code-bg": "#1d2021",
        "accent-ink": "#282828",
    },
};

test("a readable page's hex colors are kept; the grounds are made solid", () => {
    const theme = readTheme({ ...gruvbox, colors: { ...gruvbox.colors, bg: "#28282880", hover: "red" } });

    assert.equal(theme?.mode, "dark");
    assert.equal(theme?.colors.accent, "#d79921");
    assert.equal(theme?.colors.bg, "#282828");
});

test("anything else is dropped whole", () => {
    assert.equal(readTheme({ ...gruvbox, mode: "dim" }), undefined);
    assert.equal(readTheme({ ...gruvbox, colors: { ...gruvbox.colors, brand: "url(x)" } }), undefined);
    assert.equal(readTheme({ mode: "light", colors: { bg: "#ffffff" } }), undefined);
    assert.equal(readTheme("nope"), undefined);
});

test("all-black, all-white, and all-transparent palettes are not themes", () => {
    for (const color of ["#000000", "#ffffff", "#00000000"]) {
        const colors = Object.fromEntries(THEME_TOKENS.map((token) => [token, color]));

        assert.equal(readTheme({ mode: "dark", colors }), undefined);
    }
});

test("foregrounds must remain visible after alpha compositing on the settings surfaces", () => {
    for (const token of ["text", "body", "muted", "accent", "brand", "ok", "warn", "err"] as const) {
        for (const color of ["#ffffff00", "#ffffff01", DEFAULT_THEME.colors.bg, "#1b1c27"]) {
            const colors = { ...DEFAULT_THEME.colors, [token]: color };

            assert.equal(readTheme({ ...DEFAULT_THEME, colors }), undefined, token);
        }
    }

    for (const token of ["desk", "card", "code-bg"] as const) {
        const colors = { ...DEFAULT_THEME.colors, [token]: DEFAULT_THEME.colors.text };

        assert.equal(readTheme({ ...DEFAULT_THEME, colors }), undefined, token);
    }

    for (const color of ["#ffffff00", DEFAULT_THEME.colors["accent-fill"]]) {
        const colors = { ...DEFAULT_THEME.colors, "accent-ink": color };

        assert.equal(readTheme({ ...DEFAULT_THEME, colors }), undefined);
    }
});

test("readable dark, light, and partially transparent themes are kept, including black text", () => {
    assert.deepEqual(readTheme(DEFAULT_THEME), DEFAULT_THEME);

    const light = {
        mode: "light",
        colors: {
            ...DEFAULT_THEME.colors,
            desk: "#ffffff",
            bg: "#ffffff",
            card: "#ffffff",
            "code-bg": "#eeeeee",
            text: "#000000",
            body: "#111111",
            muted: "#555555",
        },
    };

    assert.deepEqual(readTheme(light), light);

    const translucent = { ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors, card: "#20223080", text: "#c0caf5dd" } };

    assert.deepEqual(readTheme(translucent), translucent);
});

test("an unreadable theme saved by an older app falls back to the default", (t) => {
    const folder = mkdtempSync(join(tmpdir(), "gui-bad-theme-"));
    const path = join(folder, "theme.json");

    t.after(() => rmSync(folder, { recursive: true, force: true }));

    for (const color of ["#000000", "#00000000"]) {
        const colors = Object.fromEntries(THEME_TOKENS.map((token) => [token, color]));

        writeFileSync(path, JSON.stringify({ mode: "dark", colors }));
        assert.deepEqual(loadTheme(path), DEFAULT_THEME);
    }
});

test("theme.json round-trips; a missing or broken one gives the default", () => {
    const folder = mkdtempSync(join(tmpdir(), "gui-theme-"));
    const path = join(folder, "theme.json");

    assert.deepEqual(loadTheme(path), DEFAULT_THEME);

    const theme = readTheme(gruvbox)!;

    saveTheme(path, theme);
    assert.deepEqual(loadTheme(path), theme);

    writeFileSync(path, "{");
    assert.deepEqual(loadTheme(path), DEFAULT_THEME);
});

test("the tray's mask takes the color, by its coverage", () => {
    // Two BGRA pixels, premultiplied: white and opaque, white at half coverage.
    const bitmap = Buffer.from([255, 255, 255, 255, 128, 128, 128, 128]);

    tint(bitmap, { r: 0xd7, g: 0x99, b: 0x21 });
    assert.deepEqual([...bitmap], [0x21, 0x99, 0xd7, 255, 17, 77, 108, 128]);
});
