import { strict as assert } from "node:assert";
import { test } from "node:test";
import { pageCss, translucencySupport } from "../main/appearance";
import { defaultSettings, validateSettings } from "../main/settings";

test("macOS and Windows 11 22H2 blur at any time; Linux needs the window made see-through at start", () => {
    assert.deepEqual(translucencySupport("darwin", "15.1.0", false), { kind: "live", blur: "system" });
    assert.deepEqual(translucencySupport("win32", "10.0.22631", false), { kind: "live", blur: "system" });
    assert.equal(translucencySupport("win32", "10.0.19045", false).kind, "unsupported");
    assert.deepEqual(translucencySupport("linux", "6.8.0", false), { kind: "restart" });
    assert.deepEqual(translucencySupport("linux", "6.8.0", true), { kind: "live", blur: "compositor" });
});

test("the page's grounds take the opacity; what floats over them stays solid", () => {
    const css = pageCss(82);

    assert.match(css, /--bg: color-mix\(in srgb, var\(--gui-bg\) 82%, transparent\)/);
    assert.match(css, /--panel: color-mix\(in srgb, var\(--gui-panel\) 82%, transparent\)/);
    // The desk, between tiled windows, lets more through.
    assert.match(css, /var\(--gui-desk\) 47%/);
    assert.match(css, /\.sheet,[\s\S]*--bg: var\(--gui-bg\);/);
    assert.match(pageCss(20), /var\(--gui-desk\) 0%/);
    assert.match(pageCss(140), /var\(--gui-bg\) 100%/);
});

test("appearance is off by default, and its values are checked", () => {
    assert.equal(defaultSettings().appearance.translucent, false);

    const { settings, problems } = validateSettings({
        appearance: { translucent: true, opacity: 150, macMaterial: "hud", windowsMaterial: "glass" },
    });

    assert.equal(settings.appearance.translucent, true);
    assert.equal(settings.appearance.opacity, 82);
    assert.equal(settings.appearance.macMaterial, "hud");
    assert.equal(settings.appearance.windowsMaterial, "acrylic");
    assert.deepEqual(problems.map((problem) => problem.path).sort(), ["appearance.opacity", "appearance.windowsMaterial"]);
});
