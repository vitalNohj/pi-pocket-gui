import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isNewSessionKey, linkAction, linkInArgv, newSessionMenuItem, newSessionStep, readPageEvents } from "../main/new-session";

test("pi-pocket://new is a New session link, in each form a system passes it", () => {
    assert.equal(linkAction("pi-pocket://new"), "new");
    assert.equal(linkAction("pi-pocket://new/"), "new");
    assert.equal(linkAction("PI-POCKET://NEW"), "new");
    assert.equal(linkAction("pi-pocket:new"), "new");
    assert.equal(linkAction("pi-pocket://new?from=raycast"), "new");
});

test("other links, other schemes, and text that is not a link ask for nothing", () => {
    assert.equal(linkAction("pi-pocket://"), undefined);
    assert.equal(linkAction("pi-pocket://open/12"), undefined);
    assert.equal(linkAction("pi-pocket://newer"), undefined);
    assert.equal(linkAction("https://new"), undefined);
    assert.equal(linkAction("pi-pocket-gui://new"), undefined);
    assert.equal(linkAction("new"), undefined);
    assert.equal(linkAction(""), undefined);
});

test("the link is found among a command line's arguments, wherever it is", () => {
    assert.equal(linkInArgv(["/opt/Pi Pocket/pi-pocket-gui", "pi-pocket://new"]), "pi-pocket://new");
    assert.equal(linkInArgv(["C:\\Pi Pocket\\pi-pocket-gui.exe", "--allow-file-access-from-files", "pi-pocket://new/"]), "pi-pocket://new/");
    assert.equal(linkInArgv(["electron", ".", "--autostart"]), undefined);
});

test("New session asks the page only when it shows and handles newSession", () => {
    const newer = new Set(["visibility", "open", "approve", "newSession"]);

    assert.equal(newSessionStep({ showingServer: true, pageEvents: newer }), "send");
    // The settings screen: the window only.
    assert.equal(newSessionStep({ showingServer: false, pageEvents: newer }), "show");
    // An older Pi Pocket names no events: the window only.
    assert.equal(newSessionStep({ showingServer: true, pageEvents: new Set() }), "show");
    assert.equal(newSessionStep({ showingServer: true, pageEvents: new Set(["visibility", "open"]) }), "show");
    // The page has not subscribed yet: it is loading.
    assert.equal(newSessionStep({ showingServer: true, pageEvents: undefined }), "wait");
});

test("the events a page names are read as strings, and anything else is dropped", () => {
    assert.deepEqual([...readPageEvents(["open", 3, null, "newSession"])], ["open", "newSession"]);
    assert.deepEqual([...readPageEvents(undefined)], []);
    assert.deepEqual([...readPageEvents("newSession")], []);
    assert.equal(readPageEvents(["x".repeat(101)]).size, 0);
});

test("⌘N on macOS and Ctrl+N elsewhere; not with Shift, Alt, or the other modifier", () => {
    const key = (fields: Partial<{ key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean; type: string }>) => ({
        type: "keyDown",
        key: "n",
        control: false,
        meta: false,
        alt: false,
        shift: false,
        ...fields,
    });

    assert.equal(isNewSessionKey(key({ meta: true }), "darwin"), true);
    assert.equal(isNewSessionKey(key({ control: true }), "darwin"), false);
    assert.equal(isNewSessionKey(key({ control: true }), "linux"), true);
    assert.equal(isNewSessionKey(key({ control: true, key: "N" }), "win32"), true);
    assert.equal(isNewSessionKey(key({ meta: true }), "linux"), false);
    assert.equal(isNewSessionKey(key({ control: true, shift: true }), "linux"), false);
    assert.equal(isNewSessionKey(key({ control: true, alt: true }), "linux"), false);
    assert.equal(isNewSessionKey(key({ control: true, type: "keyUp" }), "linux"), false);
    assert.equal(isNewSessionKey(key({ control: true, key: "," }), "linux"), false);
});

test("the menu item is New Session on CmdOrCtrl+N", () => {
    let clicked = false;
    const item = newSessionMenuItem(() => (clicked = true));

    assert.equal(item.label, "New Session");
    assert.equal(item.accelerator, "CommandOrControl+N");
    (item.click as () => void)();
    assert.equal(clicked, true);
});
