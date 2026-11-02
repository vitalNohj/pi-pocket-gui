import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
    canReturn,
    connectFailed,
    hostOf,
    keepsLocalAsked,
    LocalStopNotice,
    localChoiceStatus,
    reconnectsByItself,
    remoteChoiceStatus,
    returnsByItself,
    shownReason,
    sideOf,
    stoppedAnswering,
    whenLocalReady,
    whenLost,
} from "../main/server-choice";
import type { ConfigReason, Side } from "../shared/types";

const remote = "https://pocket.example.com/";
const outage: ConfigReason = { kind: "outage", url: remote, message: "Not reachable" };

test("a click on a choice changes only the side shown: Back stays with the server in use (items 1-3)", () => {
    // Connected to another server; the person looks at This computer, then back at Another server.
    assert.equal(canReturn({ inUse: "remote", viewing: "remote", loaded: true }), true);
    assert.equal(canReturn({ inUse: "remote", viewing: "local", loaded: true }), false, "Back belongs to the side in use");
    assert.equal(canReturn({ inUse: "remote", viewing: "remote", loaded: true }), true, "back on Another server, Back is there again");
    // Not connected: no Back.
    assert.equal(canReturn({ inUse: "remote", viewing: "remote", loaded: false }), false);
    // The same for This computer.
    assert.equal(canReturn({ inUse: "local", viewing: "local", loaded: true }), true);
    assert.equal(canReturn({ inUse: "local", viewing: "remote", loaded: true }), false);
});

test("looking at This computer does not connect to the last remote address by itself (item 1)", () => {
    for (const reason of [outage, { kind: "load-failed", url: remote, message: "x" }, { kind: "not-detected", probe: { kind: "unreachable", url: remote, message: "x" } }] satisfies ConfigReason[]) {
        assert.equal(reconnectsByItself({ reason, viewing: "local", autoConnect: true }), false);
        assert.equal(reconnectsByItself({ reason, viewing: "remote", autoConnect: true }), true, "the retry goes on as before on Another server (item 8)");
        assert.equal(reconnectsByItself({ reason, viewing: "remote", autoConnect: false }), false);
        assert.equal(returnsByItself(reason), true);
    }

    for (const reason of [{ kind: "user" }, { kind: "first-run" }, { kind: "local" }, { kind: "crashed", message: "x" }] satisfies ConfigReason[]) {
        assert.equal(reconnectsByItself({ reason, viewing: "remote", autoConnect: true }), false, `${reason.kind}: the person chose the screen`);
    }
});

test("a remote server that stops while the person looks at This computer: no jump, the error waits on Another server (item 4)", () => {
    assert.deepEqual(whenLost({ lost: "remote", showing: "config", viewing: "local" }), { show: false, viewing: "local", retry: false });
    assert.equal(stoppedAnswering(remote).line, "pocket.example.com stopped answering");
    assert.equal(stoppedAnswering(remote).kind, "dropped");
    // The outage belongs to Another server: not shown on This computer, shown again on Another server.
    assert.equal(sideOf(outage, "remote"), "remote");
    assert.deepEqual(shownReason(outage, "remote", "local"), { kind: "user" });
    assert.deepEqual(shownReason(outage, "remote", "remote"), outage);
    // Back is gone with the connection.
    assert.equal(canReturn({ inUse: "remote", viewing: "remote", loaded: false }), false);
});

test("the server in use stops while it shows: the screen opens on its side with the error (item 8)", () => {
    assert.deepEqual(whenLost({ lost: "remote", showing: "server", viewing: "local" }), { show: true, viewing: "remote", retry: true });
    assert.deepEqual(whenLost({ lost: "remote", showing: "config", viewing: "remote" }), { show: true, viewing: "remote", retry: true });
    assert.deepEqual(whenLost({ lost: "local", showing: "server", viewing: "remote" }), { show: true, viewing: "local", retry: false });
    assert.deepEqual(whenLost({ lost: "local", showing: "config", viewing: "local" }), { show: true, viewing: "local", retry: false });
    assert.equal(sideOf({ kind: "crashed", message: "x" }, "local"), "local");
    assert.equal(sideOf({ kind: "load-failed", url: remote, message: "x" }, "remote"), "remote");
    assert.equal(sideOf({ kind: "local" }, "remote"), "local");
    assert.equal(sideOf({ kind: "user" }, "remote"), undefined);
});

test("the local server that the person starts takes the window; one that starts by itself does not (items 5, 6, 9)", () => {
    for (const viewing of ["local", "remote"] satisfies Side[]) {
        // Start, Install, or Open: the window uses it, which ends the remote connection.
        assert.equal(whenLocalReady({ inUse: "remote", asked: true, showing: "config", viewing }), "show");
    }

    // While another server is in use, a start the person did not ask for does not take the window.
    assert.equal(whenLocalReady({ inUse: "remote", asked: false, showing: "server", viewing: "remote" }), "none");
    assert.equal(whenLocalReady({ inUse: "remote", asked: false, showing: "config", viewing: "local" }), "none");
    // At the app's start, with This computer in use: it opens, as before (item 9).
    assert.equal(whenLocalReady({ inUse: "local", asked: false, showing: "config", viewing: "local" }), "show");
    assert.equal(whenLocalReady({ inUse: "local", asked: false, showing: "server", viewing: "local" }), "show");
    // The person looks at Another server: it loads, Back waits on This computer, nothing jumps.
    assert.equal(whenLocalReady({ inUse: "local", asked: false, showing: "config", viewing: "remote" }), "load");
});

test("the local server stops on its own while a remote server is in use: nothing jumps, Back stays (item 7)", () => {
    assert.deepEqual(whenLost({ lost: "local", showing: "server", viewing: "remote" }).viewing, "local", "only when local is in use");
    // index.ts calls whenLost only for the server in use; for a local stop with remote in use the state only updates.
    assert.equal(canReturn({ inUse: "remote", viewing: "remote", loaded: true }), true);
    assert.deepEqual(localChoiceStatus({ status: "failed", message: "Pi Pocket stopped.", crash: "cloudflared is not installed" }), {
        label: "Error",
        state: "not-detected",
        detail: "Stopped on its own: cloudflared is not installed",
    });
});

test("This computer choice: Not installed, Stopped, Starting, Running, or Error (item 11)", () => {
    assert.equal(localChoiceStatus({ status: "absent" }).label, "Not installed");
    assert.equal(localChoiceStatus({ status: "installing" }).label, "Not installed");
    assert.equal(localChoiceStatus({ status: "stopped" }).label, "Stopped");
    assert.equal(localChoiceStatus({ status: "stopping" }).label, "Stopped");
    assert.equal(localChoiceStatus({ status: "starting" }).label, "Starting");
    assert.deepEqual(localChoiceStatus({ status: "running" }), { label: "Running", state: "connected" });
    assert.deepEqual(localChoiceStatus({ status: "external" }), { label: "Running", state: "connected" });
    assert.deepEqual(localChoiceStatus({ status: "failed", message: "It did not start." }), { label: "Error", state: "not-detected", detail: "It did not start." });

    for (const status of ["absent", "stopped", "starting", "running"] as const) {
        assert.equal(localChoiceStatus({ status }).detail, undefined, `${status}: no error line`);
    }
});

test("Another server choice: Not connected, Connected, or Error until the person connects or checks with success (item 11)", () => {
    assert.deepEqual(remoteChoiceStatus({ connectedUrl: undefined, error: undefined }), { label: "Not connected", state: "checking" });
    assert.deepEqual(remoteChoiceStatus({ connectedUrl: remote, error: undefined }), { label: "Connected", state: "connected" });
    assert.deepEqual(remoteChoiceStatus({ connectedUrl: undefined, error: stoppedAnswering(remote) }), {
        label: "Error",
        state: "not-detected",
        detail: "pocket.example.com stopped answering",
    });
    // A failed Connect is an error too.
    const failed = connectFailed({ kind: "unreachable", url: remote, message: "Offline" });

    assert.equal(failed.kind, "failed");
    assert.equal(remoteChoiceStatus({ connectedUrl: undefined, error: failed }).label, "Error");
    assert.equal(connectFailed({ kind: "other", url: remote, status: 404, message: "x", canOpen: false }).line, "No Pi Pocket at pocket.example.com");
    assert.equal(connectFailed({ kind: "invalid", url: "nope", message: "x" }).line, "The address is not valid");
    assert.equal(hostOf("not a url"), "not a url");
    assert.equal(hostOf("http://127.0.0.3:8898/x"), "127.0.0.3:8898");
});

test("a notification for each stop on its own, not for each retry, Stop, Uninstall, quit, or update (item 12)", () => {
    const notice = new LocalStopNotice();
    const crash = { kind: "crashed", message: "cloudflared is not installed" } as const;

    assert.equal(notice.down(crash, false), true);
    assert.equal(notice.down(crash, false), false, "the retries of the same stop");
    notice.reset(); // It ran again.
    assert.equal(notice.down(crash, false), true, "a new stop");

    const fresh = new LocalStopNotice();

    assert.equal(fresh.down({ kind: "stopped" }, false), false, "Stop or Uninstall");
    assert.equal(fresh.down({ kind: "unavailable" }, false), false, "not installed, or another Pi Pocket at the port");
    assert.equal(fresh.down({ kind: "update-failed" }, false), false, "an update goes back to the version before");
    assert.equal(fresh.down(crash, true), false, "the app quits");
    assert.equal(fresh.down(crash, false), true);
});

test("the person's Start survives a crash and an update that goes back; Stop and Uninstall end it (F1)", () => {
    assert.equal(keepsLocalAsked({ kind: "crashed", message: "x" }), true);
    assert.equal(keepsLocalAsked({ kind: "update-failed" }), true, "the version before starts, and then the window opens it");
    assert.equal(keepsLocalAsked({ kind: "stopped" }), false);
    assert.equal(keepsLocalAsked({ kind: "unavailable" }), false);
    // The request kept, the version before is ready: the window uses it, which ends the remote connection.
    assert.equal(whenLocalReady({ inUse: "remote", asked: keepsLocalAsked({ kind: "update-failed" }), showing: "server", viewing: "remote" }), "show");
});
