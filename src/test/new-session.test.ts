import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    isNewSessionKey,
    linkAction,
    linkInArgv,
    newSessionMenuItem,
    newSessionStep,
    type NewSessionView,
    PendingNewSession,
    readPageEvents,
} from "../main/new-session";

const NEWER = new Set(["visibility", "open", "approve", "newSession"]);
const server = (pageEvents: ReadonlySet<string> | undefined): NewSessionView => ({ showingServer: true, serverLoaded: true, pageEvents });
const settings = (pageEvents: ReadonlySet<string> | undefined): NewSessionView => ({ showingServer: false, serverLoaded: true, pageEvents });

/** A pending request with timers the test runs by hand, and a count of the events it sent. */
function pending(): { request: PendingNewSession; sent: () => number; expire: () => void } {
    let sent = 0;
    let run: (() => void) | undefined;
    const request = new PendingNewSession(
        () => sent++,
        {
            set: (next) => {
                run = next;

                return 1;
            },
            clear: () => (run = undefined),
        },
    );

    return { request, sent: () => sent, expire: () => run?.() };
}

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
    assert.equal(newSessionStep(server(NEWER)), "send");
    // The settings screen: the window only.
    assert.equal(newSessionStep(settings(NEWER)), "show");
    // No server loaded: the window only.
    assert.equal(newSessionStep({ showingServer: true, serverLoaded: false, pageEvents: undefined }), "show");
    // An older Pi Pocket names no events: the window only.
    assert.equal(newSessionStep(server(new Set())), "show");
    assert.equal(newSessionStep(server(new Set(["visibility", "open"]))), "show");
    // The page has not subscribed yet: it is loading.
    assert.equal(newSessionStep(server(undefined)), "wait");
});

test("a New session asked for on the settings screen shows the window only and never waits", () => {
    assert.equal(newSessionStep(settings(undefined)), "show");

    const { request, sent } = pending();

    request.request(settings(undefined));
    assert.equal(request.waiting, false);
    // The person goes back to the server, and its page subscribes: no sheet.
    request.screenChanged(true);
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 0);
});

test("a request that waits for the page sends once the page subscribes, if it handles newSession", () => {
    const { request, sent } = pending();

    request.request(server(undefined));
    assert.equal(request.waiting, true);
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 1);
    assert.equal(request.waiting, false);
    // A later subscription (the page loads again) sends nothing.
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 1);

    const older = pending();

    older.request.request(server(undefined));
    older.request.pageSubscribed(server(new Set(["visibility"])));
    assert.equal(older.sent(), 0);
    assert.equal(older.request.waiting, false);
});

test("a waiting request is dropped when the window changes to the settings screen", () => {
    const { request, sent } = pending();

    request.request(server(undefined));
    assert.equal(request.waiting, true);
    request.screenChanged(false);
    assert.equal(request.waiting, false);
    // Back on the server within the wait, its page subscribes: no sheet.
    request.screenChanged(true);
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 0);
});

test("a waiting request ends after its time", () => {
    const { request, sent, expire } = pending();

    request.request(server(undefined));
    expire();
    assert.equal(request.waiting, false);
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 0);
});

test("a link that starts the app waits through the settings screen the app starts with, until the server's page subscribes", () => {
    const { request, sent } = pending();

    request.request({ showingServer: false, serverLoaded: false, pageEvents: undefined }, true);
    assert.equal(request.waiting, true);
    // The app connects: the server shows, then its page subscribes.
    request.screenChanged(true);
    request.pageSubscribed(server(NEWER));
    assert.equal(sent(), 1);
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
