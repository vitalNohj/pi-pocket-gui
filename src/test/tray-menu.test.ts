import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildTrayMenu, placeTrayMenu, readAccent, trayMenuPalette, type ScreenRect, type TrayScreen } from "../main/tray-menu";
import { menuPage } from "../main/tray-popup";
import { defaultSettings, validateSettings } from "../main/settings";
import type { PinnedSession, ThemeColors } from "../shared/types";

/** A display whose taskbar takes nothing, so the work area is the whole screen. */
function display(bounds: ScreenRect, workArea: ScreenRect = bounds): TrayScreen {
    return { bounds, workArea };
}

const screen = display({ x: 0, y: 0, width: 1920, height: 1080 });
const theme: ThemeColors = {
    mode: "dark",
    colors: {
        desk: "#141210",
        bg: "#201e1b",
        card: "#2a2723",
        text: "#f4f0e8",
        body: "#f7f4ee",
        muted: "#b3aa9e",
        accent: "#d8a24e",
        "accent-fill": "#d8a24e",
        "accent-ink": "#201e1b",
        brand: "#d8a24e",
        ok: "#7dba6a",
        warn: "#e0b15a",
        err: "#e07a6a",
        "code-bg": "#191714",
    },
};

function pin(id: number, title: string): PinnedSession {
    return { id, url: `/s/${id}`, title, state: "waiting", label: "Waiting" };
}

test("the menu keeps every item, in the order the native menu uses", () => {
    let opened = "";
    const menu = buildTrayMenu({
        badge: 3,
        update: { label: "Update ready to install", click: () => (opened = "update") },
        pins: [pin(1, "First draft"), pin(2, "A  double  gap")],
        showWindow: () => (opened = "window"),
        openSettings: () => (opened = "settings"),
        quit: () => (opened = "quit"),
        openPin: (url) => (opened = url),
    });

    assert.deepEqual(
        menu.rows.map((row) => (row.kind === "separator" ? "—" : row.kind === "header" ? row.label : row.label)),
        ["Open Pi Pocket  (3 need you)", "Update ready to install", "—", "Pinned", "First draft", "A double gap", "—", "Server settings…", "—", "Quit"],
    );
    assert.deepEqual(
        menu.rows.filter((row) => row.kind === "action").map((row) => row.mark),
        [undefined, undefined, "◆", "◆", undefined, undefined],
    );

    menu.actions.find((action) => action.id === "open")?.run();
    assert.equal(opened, "window");
    menu.actions.find((action) => action.id === "pin-2")?.run();
    assert.equal(opened, "/s/2");
});

test("without a badge, an update, or pins, the menu is Open, Server settings, Quit", () => {
    const menu = buildTrayMenu({
        badge: 0,
        update: undefined,
        pins: [],
        showWindow: () => undefined,
        openSettings: () => undefined,
        quit: () => undefined,
        openPin: () => undefined,
    });

    assert.deepEqual(
        menu.rows.map((row) => (row.kind === "action" ? row.label : row.kind)),
        ["Open Pi Pocket", "separator", "Server settings…", "separator", "Quit"],
    );
});

test("the menu opens away from the taskbar and stays on its screen", () => {
    const menu = { width: 264, height: 220 };
    const bottom = placeTrayMenu({ icon: { x: 1860, y: 1048, width: 32, height: 32 }, menu, screens: [screen], gap: 4, margin: 8 });

    // The icon sits in the bottom corner, so the menu opens above it and shifts left to stay on screen.
    assert.equal(bottom.y, 1048 - 4 - 220);
    assert.equal(bottom.x, 1920 - 8 - 264);

    const top = placeTrayMenu({ icon: { x: 400, y: 0, width: 40, height: 40 }, menu, screens: [screen], gap: 4, margin: 8 });

    assert.equal(top.y, 44);
    assert.equal(top.x, 400);

    const left = placeTrayMenu({ icon: { x: 0, y: 300, width: 48, height: 40 }, menu, screens: [screen], gap: 4, margin: 8 });

    // The menu fits above the icon, so it opens there and shifts right to stay on screen.
    assert.equal(left.x, 8);
    assert.equal(left.y, 300 - 4 - 220);
});

test("a menu taller than the screen is pinned to the top margin", () => {
    const place = placeTrayMenu({
        icon: { x: 100, y: 1000, width: 40, height: 40 },
        menu: { width: 264, height: 2000 },
        screens: [screen],
        gap: 4,
        margin: 8,
    });

    assert.equal(place.y, 8);
});

test("the menu uses the screen its icon is on", () => {
    const second = display({ x: 1920, y: 0, width: 1280, height: 1024 });
    const place = placeTrayMenu({
        icon: { x: 3000, y: 980, width: 40, height: 40 },
        menu: { width: 264, height: 220 },
        screens: [screen, second],
        gap: 4,
        margin: 8,
    });

    assert.ok(place.x >= second.bounds.x);
    assert.ok(place.x + 264 <= second.bounds.x + second.bounds.width);
});

test("a tray icon on the taskbar is matched by the screen's bounds, then clamped to its work area", () => {
    // The taskbar is the bottom 48px, so the icon's center is outside the work area but inside the bounds.
    const second = display(
        { x: 1920, y: 0, width: 1280, height: 1024 },
        { x: 1920, y: 0, width: 1280, height: 1024 - 48 },
    );
    const place = placeTrayMenu({
        icon: { x: 3000, y: 992, width: 32, height: 32 },
        menu: { width: 264, height: 220 },
        screens: [screen, second],
        gap: 4,
        margin: 8,
    });

    assert.ok(place.x >= second.workArea.x, "stays on the icon's display");
    assert.ok(place.y + 220 <= second.workArea.y + second.workArea.height, "stays above the taskbar");
});

test("the Windows look follows the Windows theme; the Pi Pocket look follows the page", () => {
    const windows = trayMenuPalette("windows", true, theme, "#0067c0");

    assert.equal(windows.mode, "dark");
    assert.equal(windows.menu, "#2c2c2c");
    assert.match(windows.font, /Segoe UI Variable/);
    assert.equal(trayMenuPalette("windows", false, theme, "#0067c0").mode, "light");

    const themed = trayMenuPalette("theme", false, theme, "#0067c0");

    assert.equal(themed.menu, theme.colors.bg);
    assert.equal(themed.text, theme.colors.text);
    assert.equal(themed.mode, "dark");
    assert.match(themed.font, /Geist/);
});

test("Windows' accent arrives as RRGGBBAA, so the trailing alpha is dropped", () => {
    assert.equal(readAccent("0067c0ff"), "#0067c0");
    assert.equal(readAccent("#0067C0FF"), "#0067c0");
    assert.equal(readAccent("#112233"), "#112233");
    assert.equal(readAccent("blue"), "#0067c0");
    assert.equal(readAccent(undefined), "#0067c0");
});

test("a pin title's doubled ampersand is undone, so the popup shows one", () => {
    const menu = buildTrayMenu({
        badge: 0,
        update: undefined,
        pins: [pin(1, "Fix A & B")],
        showWindow: () => undefined,
        openSettings: () => undefined,
        quit: () => undefined,
        openPin: () => undefined,
    });
    const row = menu.rows.find((each) => each.kind === "action" && each.id === "pin-1");

    assert.equal(row?.kind === "action" ? row.label : undefined, "Fix A & B");

    const page = menuPage(menu.rows, trayMenuPalette("windows", false, theme, "#0067c0"));

    assert.match(page, /Fix A &amp; B/);
    assert.doesNotMatch(page, /&amp;&amp;/);
});

test("the page draws the items and escapes a label", () => {
    const menu = buildTrayMenu({
        badge: 0,
        update: undefined,
        pins: [pin(1, `<script>alert("x")</script>`)],
        showWindow: () => undefined,
        openSettings: () => undefined,
        quit: () => undefined,
        openPin: () => undefined,
    });
    const page = menuPage(menu.rows, trayMenuPalette("windows", false, theme, "#0067c0"));

    assert.match(page, /role="menu"/);
    assert.match(page, /Server settings…/);
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /&lt;script&gt;alert/);
});

test("the tray menu setting defaults to the Windows look, and only windows or theme are kept", () => {
    assert.equal(defaultSettings().appearance.trayMenu, "windows");
    assert.equal(validateSettings({ appearance: { trayMenu: "theme" } }).settings.appearance.trayMenu, "theme");
    assert.equal(validateSettings({ appearance: { trayMenu: "native" } }).settings.appearance.trayMenu, "windows");
});

test("the settings screen offers the tray menu on Windows only", () => {
    const page = readFileSync(join(__dirname, "..", "renderer", "config", "index.html"), "utf8");
    const row = page.slice(page.indexOf('id="tray-menu-row"'), page.indexOf("</label>", page.indexOf('id="tray-menu-row"')));

    assert.match(row, /data-platform="win32"/);
    assert.match(row, /value="windows"/);
    assert.match(row, /value="theme"/);

    // The config screen hides a row whose data-platform is not this desktop's.
    const renderer = readFileSync(join(__dirname, "..", "..", "src", "renderer", "config", "main.ts"), "utf8");

    assert.match(renderer, /row\.hidden = row\.dataset\.platform !== next\.platform/);
});
