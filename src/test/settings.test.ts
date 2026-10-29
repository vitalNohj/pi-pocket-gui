import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSettings, loadSettings, saveSettings, validateSettings } from "../main/settings";

test("a missing file gives the defaults, quietly", () => {
    const loaded = loadSettings(join(mkdtempSync(join(tmpdir(), "gui-")), "config.json"));

    assert.deepEqual(loaded.settings, defaultSettings());
    assert.deepEqual(loaded.problems, []);
});

test("valid values are kept, invalid ones fall back and are reported", () => {
    const { settings, problems } = validateSettings({
        server: { url: "opti2:9000", extraOrigins: ["https://team.cloudflareaccess.com/path"] },
        window: { closeToTray: "yes", hotkey: "Ctrl+Alt+P" },
        notifications: { allowFromNotification: "always", maxCallLength: 5 },
        connection: { retryMaxSeconds: 60 },
        bogus: {},
    });

    assert.equal(settings.server.url, "http://opti2:9000");
    assert.deepEqual(settings.server.extraOrigins, ["https://team.cloudflareaccess.com"]);
    assert.equal(settings.window.closeToTray, true);
    assert.equal(settings.window.hotkey, "Ctrl+Alt+P");
    assert.equal(settings.notifications.allowFromNotification, "always");
    assert.equal(settings.notifications.maxCallLength, 120);
    assert.equal(settings.connection.retryMaxSeconds, 60);
    assert.deepEqual(
        problems.map((problem) => problem.path).sort(),
        ["bogus", "notifications.maxCallLength", "window.closeToTray"],
    );
});

test("a broken file keeps the defaults and says why", () => {
    const path = join(mkdtempSync(join(tmpdir(), "gui-")), "config.json");

    writeFileSync(path, "{ not json");

    const loaded = loadSettings(path);

    assert.deepEqual(loaded.settings, defaultSettings());
    assert.equal(loaded.problems[0]?.path, "(file)");
});

test("saving and loading round-trips", () => {
    const path = join(mkdtempSync(join(tmpdir(), "gui-")), "nested", "config.json");
    const settings = defaultSettings();

    settings.server.url = "https://opti2.tail1234.ts.net";
    settings.window.launchAtLogin = true;
    saveSettings(path, settings);

    assert.match(readFileSync(path, "utf8"), /"version": 1/);
    assert.deepEqual(loadSettings(path), { settings, problems: [] });
});
