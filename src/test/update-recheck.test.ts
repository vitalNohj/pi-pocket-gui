import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CheckGenerations, nextUpdateStep, whenDownloaded, recheckFailedMessage, sameVersion, singleFlight, withTimeout, type RecheckFacts } from "../main/update-pick";

const offline = new Error("net::ERR_INTERNET_DISCONNECTED");

function step(facts: Partial<RecheckFacts> & Pick<RecheckFacts, "method" | "latest">) {
    return nextUpdateStep({ running: "0.2.11", ...facts });
}

test("page: the button opens the newest release, never a pulled one or old data", () => {
    // The release found at the last check is still the newest.
    assert.deepEqual(step({ method: "page", known: "0.2.12", latest: "0.2.12" }), { kind: "open-page" });
    // A newer one came out: its page opens (the caller uses the release it just read).
    assert.deepEqual(step({ method: "page", known: "0.2.12", latest: "v0.2.14" }), { kind: "open-page" });
    // The newer release was pulled.
    assert.deepEqual(step({ method: "page", known: "0.2.12", latest: "0.2.11" }), { kind: "current" });
    assert.deepEqual(step({ method: "page", known: "0.2.12", latest: undefined }), { kind: "current" });
    // The check failed: nothing opens, and the text names the version it knows.
    const failed = step({ method: "page", known: "0.2.12", latest: offline });

    assert.equal(failed.kind, "failed");
    assert.match(failed.kind === "failed" ? failed.message : "", /Could not check for a newer version.*0\.2\.12/);
});

test("download: an image opens only while it is the newest; an older one is dropped and the newest downloads", () => {
    // Nothing downloaded yet, the release is unchanged: download it.
    assert.deepEqual(step({ method: "download", known: "0.2.12", latest: "0.2.12" }), { kind: "download", dropOld: false });
    // Nothing downloaded yet, newer one out: download the newer one.
    assert.deepEqual(step({ method: "download", known: "0.2.12", latest: "0.2.14" }), { kind: "download", dropOld: false });
    // Downloaded image is still the newest: open it.
    assert.deepEqual(step({ method: "download", known: "0.2.12", downloaded: "0.2.12", latest: "v0.2.12" }), { kind: "open-image" });
    // Downloaded image is old: drop it, never open it, download the newest.
    assert.deepEqual(step({ method: "download", known: "0.2.12", downloaded: "0.2.12", latest: "0.2.14" }), {
        kind: "download",
        dropOld: true,
    });
    // Pulled: nothing newer than the running app.
    assert.deepEqual(step({ method: "download", known: "0.2.12", downloaded: "0.2.12", latest: "0.2.11" }), { kind: "current" });
    // The check failed: the image does not open on old data.
    assert.equal(step({ method: "download", known: "0.2.12", downloaded: "0.2.12", latest: offline }).kind, "failed");
});

test("install: restart only for the newest download; a newer release downloads first", () => {
    // Downloaded version is still the newest: ask to restart.
    assert.deepEqual(step({ method: "install", known: "0.2.12", downloaded: "0.2.12", latest: "0.2.12" }), { kind: "restart" });
    // Newer one out: electron-updater downloads it, then the app asks. The old one is not installed first.
    assert.deepEqual(step({ method: "install", known: "0.2.12", downloaded: "0.2.12", latest: "0.2.14" }), { kind: "wait-download" });
    // Nothing downloaded yet.
    assert.deepEqual(step({ method: "install", known: "0.2.12", latest: "0.2.12" }), { kind: "wait-download" });
    // Pulled.
    assert.deepEqual(step({ method: "install", known: "0.2.12", downloaded: "0.2.12", latest: undefined }), { kind: "current" });
    // The check failed.
    assert.equal(step({ method: "install", known: "0.2.12", downloaded: "0.2.12", latest: offline }).kind, "failed");
});

test("the failed check text says that the version may not be the newest", () => {
    assert.equal(
        recheckFailedMessage("GitHub answered HTTP 503.", "0.2.12"),
        "Could not check for a newer version: GitHub answered HTTP 503. The last version found was 0.2.12. Try again when GitHub can be reached.",
    );
    assert.equal(
        recheckFailedMessage("offline", undefined),
        "Could not check for a newer version: offline. Try again when GitHub can be reached.",
    );
});

test("versions match with or without a v, and bad versions never match", () => {
    assert.equal(sameVersion("v0.2.12", "0.2.12"), true);
    assert.equal(sameVersion("0.2.12", "0.2.13"), false);
    assert.equal(sameVersion("x", "x"), false);
});

test("two fast clicks run the action once", async () => {
    let runs = 0;
    let finish: () => void = () => undefined;
    const act = singleFlight(async () => {
        runs += 1;
        await new Promise<void>((resolve) => {
            finish = resolve;
        });
    });
    const first = act();
    const second = act();

    assert.equal(first, second);
    assert.equal(runs, 1);
    finish();
    await first;
    // Once it ends, the next click runs it again.
    const third = act();

    assert.equal(runs, 2);
    finish();
    await third;
});

test("a slow check fails instead of hanging", async () => {
    await assert.rejects(withTimeout(new Promise(() => undefined), 20, "The check"), /The check took longer than 1 seconds/);
    assert.equal(await withTimeout(Promise.resolve(5), 1000, "The check"), 5);
});

test("install: a late result of a check that timed out neither installs on quit nor asks to restart", () => {
    const generations = new CheckGenerations();
    const token = generations.begin();

    // The action gave up: the check goes on in electron-updater and finishes later.
    generations.abandon(token);
    assert.equal(generations.live(), false);
    assert.deepEqual(whenDownloaded({ live: generations.live(), fresh: true, acting: false }), { installOnQuit: false, ask: false });

    // The next check (background or a new action) owns the result again.
    const next = generations.begin();

    assert.equal(generations.live(), true);
    // An old token does not abandon the newer check.
    generations.abandon(token);
    assert.equal(generations.live(), true);
    generations.abandon(next);
    assert.equal(generations.live(), false);
});

test("install: a background check still downloads, installs on quit, and asks to restart", () => {
    const generations = new CheckGenerations();

    generations.begin();
    assert.deepEqual(whenDownloaded({ live: generations.live(), fresh: true, acting: false }), { installOnQuit: true, ask: true });
    // The same download found again does not ask again.
    assert.deepEqual(whenDownloaded({ live: true, fresh: false, acting: false }), { installOnQuit: true, ask: false });
    // A running action asks itself, once it knows the newest version is here.
    assert.deepEqual(whenDownloaded({ live: true, fresh: true, acting: true }), { installOnQuit: true, ask: false });
});
