import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateSettings } from "../main/settings";
import { DEFAULT_THEME } from "../main/theme";
import { BAND, titleBarOptions } from "../main/titlebar";

test("seamless on macOS: hidden title bar, traffic lights centered in the strip", () => {
    const options = titleBarOptions("darwin", "seamless", DEFAULT_THEME);

    assert.equal(options.titleBarStyle, "hidden");
    assert.equal(options.titleBarOverlay, undefined);
    assert.ok(options.trafficLightPosition !== undefined && options.trafficLightPosition.y < BAND / 2);
});

test("seamless on Windows and Linux: the controls overlay, see-through, symbols in the theme's text color", () => {
    for (const platform of ["win32", "linux"]) {
        const options = titleBarOptions(platform, "seamless", DEFAULT_THEME);

        assert.equal(options.titleBarStyle, "hidden");
        assert.deepEqual(options.titleBarOverlay, { color: "#00000000", symbolColor: DEFAULT_THEME.colors.text, height: BAND });
    }
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
