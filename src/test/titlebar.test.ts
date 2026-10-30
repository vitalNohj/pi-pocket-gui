import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateSettings } from "../main/settings";
import { DEFAULT_THEME } from "../main/theme";
import { bandHeight, OVERLAY_HEIGHT, titleBarOptions, TRAFFIC_LIGHTS } from "../main/titlebar";

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
