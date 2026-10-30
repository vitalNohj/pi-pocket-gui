import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { tint } from "../main/badge-image";
import { DEFAULT_THEME, loadTheme, readTheme, saveTheme, THEME_TOKENS } from "../main/theme";

const gruvbox = {
    mode: "dark",
    colors: Object.fromEntries(THEME_TOKENS.map((token) => [token, "#D79921"])),
};

test("a page's colors are kept when every token is a hex color; the grounds are made solid", () => {
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
