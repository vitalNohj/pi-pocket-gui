import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateSettings } from "../main/settings";
import { DEFAULT_THEME } from "../main/theme";
import type { WebContents } from "electron";
import { bandHeight, captionScheme, OVERLAY_HEIGHT, parseAppsUseLightTheme, SchemeGuard, titleBarOptions, TRAFFIC_LIGHTS } from "../main/titlebar";

test("seamless on macOS: hidden title bar, the traffic lights near the corner, told to the page as an overlay", () => {
    const options = titleBarOptions("darwin", "seamless", DEFAULT_THEME);

    assert.equal(options.titleBarStyle, "hidden");
    assert.equal(options.titleBarOverlay, true);
    assert.deepEqual(options.trafficLightPosition, TRAFFIC_LIGHTS);
    // The band an older page is told of: just the lights (14 px) and their margin above and below.
    assert.equal(bandHeight("darwin"), 28);
});

test("seamless on Windows and Linux: the controls overlay, see-through, symbols in the theme's text color", () => {
    for (const platform of ["win32", "linux"]) {
        const options = titleBarOptions(platform, "seamless", DEFAULT_THEME);

        assert.equal(options.titleBarStyle, "hidden");
        assert.deepEqual(options.titleBarOverlay, { color: "#00000000", symbolColor: DEFAULT_THEME.colors.text, height: OVERLAY_HEIGHT });
        assert.equal(bandHeight(platform), OVERLAY_HEIGHT);
    }
});

test("Windows caption hover follows Pi Pocket's mode, not the system's", () => {
    const light = { ...DEFAULT_THEME, mode: "light" as const };

    assert.equal(captionScheme("win32", "seamless", DEFAULT_THEME), "dark");
    assert.equal(captionScheme("win32", "seamless", light), "light");
    // The system's bar draws its own hover; Linux and macOS do not tint by nativeTheme.
    assert.equal(captionScheme("win32", "system", DEFAULT_THEME), undefined);
    assert.equal(captionScheme("linux", "seamless", DEFAULT_THEME), undefined);
    assert.equal(captionScheme("darwin", "seamless", DEFAULT_THEME), undefined);
});

test("the system's app mode is read from the registry, light when unknown", () => {
    const value = (hex: string) => `\r\nHKEY_CURRENT_USER\\...\\Personalize\r\n    AppsUseLightTheme    REG_DWORD    ${hex}\r\n`;

    assert.equal(parseAppsUseLightTheme(value("0x0")), "dark");
    assert.equal(parseAppsUseLightTheme(value("0x1")), "light");
    assert.equal(parseAppsUseLightTheme(value("0x10")), "light");
    assert.equal(parseAppsUseLightTheme("ERROR: The system was unable to find the specified registry key"), "light");
    assert.equal(parseAppsUseLightTheme(""), "light");
});

test("nativeTheme is forced only while every server page is given the system's scheme", () => {
    const native = { themeSource: "system" as "system" | "dark" | "light" };
    const guard = new SchemeGuard(native);
    const main = {} as WebContents;
    const child = {} as WebContents;

    guard.want("dark");
    guard.mark(main, false);
    assert.equal(native.themeSource, "system", "the system scheme is not known yet");
    guard.setSystem("light");
    assert.equal(native.themeSource, "system", "emulation has not succeeded yet");
    guard.mark(main, true);
    assert.equal(native.themeSource, "dark");
    // A window it opens, not yet compensated: off at once.
    guard.mark(child, false);
    assert.equal(native.themeSource, "system");
    guard.mark(child, true);
    assert.equal(native.themeSource, "dark");
    // The debugger detached (DevTools): off until given again.
    guard.mark(main, false);
    assert.equal(native.themeSource, "system");
    guard.mark(main, true);
    guard.forget(child);
    assert.equal(native.themeSource, "dark");
    guard.want("light");
    assert.equal(native.themeSource, "light");
});

test("a check that finishes after its window closed does not block the override", () => {
    const native = { themeSource: "system" as "system" | "dark" | "light" };
    const guard = new SchemeGuard(native);
    const main = {} as WebContents;
    const child = {} as WebContents;

    guard.want("dark");
    guard.setSystem("light");
    guard.mark(main, true);
    guard.mark(child, false);
    guard.forget(child);
    assert.equal(native.themeSource, "dark");
    // The in-flight emulation of the closed window resolves (or fails) late.
    guard.mark(child, false);
    assert.equal(native.themeSource, "dark");
    guard.mark(child, true);
    assert.equal(native.themeSource, "dark");
});

test("without a caption scheme, nativeTheme is never touched", () => {
    const native = { themeSource: "system" as "system" | "dark" | "light" };
    const guard = new SchemeGuard(native);

    guard.setSystem("light");
    guard.mark({} as WebContents, true);
    guard.want(undefined);
    assert.equal(native.themeSource, "system");
});

test("the system's title bar changes nothing", () => {
    assert.deepEqual(titleBarOptions("darwin", "system", DEFAULT_THEME), {});
    assert.deepEqual(titleBarOptions("linux", "system", DEFAULT_THEME), {});
});

test("the setting defaults to seamless and takes only its two values", () => {
    assert.equal(validateSettings({}).settings.window.titleBar, "seamless");
    assert.equal(validateSettings({ window: { titleBar: "system" } }).settings.window.titleBar, "system");

    const wrong = validateSettings({ window: { titleBar: "hidden" } });

    assert.equal(wrong.settings.window.titleBar, "seamless");
    assert.equal(wrong.problems[0]?.path, "window.titleBar");
});
