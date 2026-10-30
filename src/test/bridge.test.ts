import assert from "node:assert/strict";
import { test } from "node:test";
import { cornerDot, dotBitmap, paintDot } from "../main/badge-image";
import { pinLabel, readBadge, readNotification, readPinned, serverPath } from "../main/bridge-input";
import { markHidden, offersAllow, showCall } from "../main/notice-text";

test("hidden characters show as marks; tabs and line breaks stay", () => {
    assert.deepEqual(markHidden("rm -rf /\u202Etxt.sh"), { text: "rm -rf /⟨U+202E⟩txt.sh", marked: true });
    assert.deepEqual(markHidden("a\u200Bb"), { text: "a⟨U+200B⟩b", marked: true });
    assert.deepEqual(markHidden("a\tb\nc"), { text: "a\tb\nc", marked: false });
    assert.deepEqual(markHidden("\u0007"), { text: "⟨U+0007⟩", marked: true });
});

test("a call is cut to its length, and only a whole, unmarked call counts as fully shown", () => {
    assert.deepEqual(showCall("bash: ls", 120), { text: "bash: ls", whole: true });
    assert.deepEqual(showCall("bash: abcdef", 6), { text: "bash:…", whole: false });
    assert.equal(showCall("bash: \u202Els", 120).whole, false);
    // Cut by code points, never inside a pair.
    assert.equal(showCall("😀😀😀", 2).text, "😀…");
});

test("Allow is offered by the setting, and never when the person may not allow", () => {
    const whole = { text: "x", whole: true };
    const cut = { text: "x…", whole: false };

    assert.equal(offersAllow("whenFullyShown", true, whole), true);
    assert.equal(offersAllow("whenFullyShown", true, cut), false);
    assert.equal(offersAllow("always", true, cut), true);
    assert.equal(offersAllow("never", true, whole), false);
    assert.equal(offersAllow("always", false, whole), false);
});

test("only the server's own paths open", () => {
    assert.equal(serverPath("/s/12"), "/s/12");
    assert.equal(serverPath("/?pip=1"), "/?pip=1");
    assert.equal(serverPath("/"), "/");
    assert.equal(serverPath("//evil.example/x"), undefined);
    assert.equal(serverPath("https://evil.example/"), undefined);
    assert.equal(serverPath("/\\evil.example"), undefined);
    assert.equal(serverPath("javascript:alert(1)"), undefined);
    assert.equal(serverPath(12), undefined);
});

test("the badge takes whole counts only", () => {
    assert.equal(readBadge(3), 3);
    assert.equal(readBadge(0), 0);
    assert.equal(readBadge(-1), undefined);
    assert.equal(readBadge(1.5), undefined);
    assert.equal(readBadge("3"), undefined);
});

test("a notification is read field by field, and dropped without a title or a server path", () => {
    assert.deepEqual(
        readNotification({
            title: "Pi needs approval · Deploy",
            body: "bash: npm run deploy",
            url: "/s/12",
            tag: "approval-1",
            urgency: "high",
            approval: { id: "a1", call: "bash: npm run deploy", may: true, allow: true, extra: 1 },
        }),
        {
            title: "Pi needs approval · Deploy",
            body: "bash: npm run deploy",
            url: "/s/12",
            tag: "approval-1",
            urgency: "high",
            approval: { id: "a1", call: "bash: npm run deploy", may: true, allow: true },
        },
    );
    assert.deepEqual(readNotification({ title: "Pi finished", url: "/s/1", urgency: "loud" }), {
        title: "Pi finished",
        body: "",
        url: "/s/1",
        tag: "",
        urgency: "normal",
    });
    assert.equal(readNotification({ title: "x", url: "https://evil.example/" }), undefined);
    assert.equal(readNotification({ url: "/" }), undefined);
    assert.equal(readNotification(null), undefined);
    // An approval without an id is no approval: no Allow or Deny to send.
    assert.equal(readNotification({ title: "x", url: "/", approval: { call: "y" } })?.approval, undefined);
});

test("pins keep the good entries, with unknown states read as seen", () => {
    assert.deepEqual(
        readPinned([
            { id: 1, title: "Deploy", state: "working", label: "Working", url: "/s/1" },
            { id: 2, title: "Odd", state: "exploding", url: "/s/2" },
            { id: "3", title: "Bad id", state: "seen", url: "/s/3" },
            { id: 4, title: "Elsewhere", state: "seen", url: "https://evil.example/" },
        ]),
        [
            { id: 1, title: "Deploy", state: "working", label: "Working", url: "/s/1" },
            { id: 2, title: "Odd", state: "seen", label: "", url: "/s/2" },
        ],
    );
    assert.deepEqual(readPinned("nope"), []);
    assert.equal(readPinned(Array.from({ length: 50 }, (_, id) => ({ id, url: `/s/${id}` }))).length, 20);
});

test("a pin's label has its mark, a short title, and no mnemonics", () => {
    assert.equal(pinLabel({ id: 1, title: "R&D  plan", state: "waiting", label: "", url: "/s/1" }), "◆  R&&D plan");
    assert.equal(
        Array.from(pinLabel({ id: 1, title: "x".repeat(80), state: "seen", label: "", url: "/s/1" })).length,
        3 + 48,
    );
});

test("the dot paints opaque in its middle and leaves the far corner alone", () => {
    const size = 32;
    const bitmap = Buffer.alloc(size * size * 4);
    const circle = cornerDot(size, size);

    paintDot(bitmap, size, size, circle);

    const at = (x: number, y: number) => (y * size + x) * 4;
    const middle = at(Math.floor(circle.cx), Math.floor(circle.cy));

    assert.deepEqual([...bitmap.subarray(middle, middle + 4)], [0x8e, 0x76, 0xf7, 255]);
    assert.equal(bitmap[at(0, 0) + 3], 0);

    const overlay = dotBitmap(16);

    assert.equal(overlay.length, 16 * 16 * 4);
    assert.equal(overlay[(8 * 16 + 8) * 4 + 3], 255);
    assert.equal(overlay[3], 0);
});

test("an update reaches each kind of install its own way", async () => {
    const { updateMethod } = await import("../main/update-pick");

    assert.equal(updateMethod("darwin", { packaged: true, appImage: false, teamSigned: false }), "download");
    assert.equal(updateMethod("darwin", { packaged: true, appImage: false, teamSigned: true }), "install");
    assert.equal(updateMethod("win32", { packaged: true, appImage: false, teamSigned: false }), "install");
    assert.equal(updateMethod("linux", { packaged: true, appImage: true, teamSigned: false }), "install");
    assert.equal(updateMethod("linux", { packaged: true, appImage: false, teamSigned: false }), "page");
    assert.equal(updateMethod("darwin", { packaged: false, appImage: false, teamSigned: true }), "source");
});

test("versions compare as numbers, and pre-releases are never newer", async () => {
    const { isNewer } = await import("../main/update-pick");

    assert.equal(isNewer("v0.1.10", "0.1.9"), true);
    assert.equal(isNewer("0.2.0", "0.10.0"), false);
    assert.equal(isNewer("0.1.0", "0.1.0"), false);
    assert.equal(isNewer("0.2.0-beta.1", "0.1.0"), false);
});

test("a release is read with its Mac images and checksums; drafts and pre-releases are skipped", async () => {
    const { macImage, readRelease, safeFileName, sha256Of } = await import("../main/update-pick");
    const hex = "a".repeat(64);
    const release = readRelease({
        tag_name: "v0.2.0",
        html_url: "https://github.com/vitalNohj/pi-pocket-gui/releases/tag/v0.2.0",
        assets: [
            { name: "pi-pocket-gui-0.2.0-mac-arm64.dmg", browser_download_url: "https://x/arm.dmg", size: 10, digest: `sha256:${hex}` },
            { name: "pi-pocket-gui-0.2.0-mac-x64.dmg", browser_download_url: "https://x/x64.dmg", size: 11 },
            { name: "pi-pocket-gui-0.2.0-mac-arm64.dmg.blockmap", browser_download_url: "https://x/b", size: 1 },
        ],
    });

    assert.equal(release?.version, "0.2.0");
    assert.equal(macImage(release!, "arm64")?.url, "https://x/arm.dmg");
    assert.equal(macImage(release!, "x64")?.url, "https://x/x64.dmg");
    assert.equal(sha256Of(macImage(release!, "arm64")!), hex);
    assert.equal(sha256Of(macImage(release!, "x64")!), undefined);
    assert.equal(readRelease({ tag_name: "v0.3.0", html_url: "h", prerelease: true }), undefined);
    assert.equal(readRelease({ tag_name: "v0.3.0", html_url: "h", draft: true }), undefined);
    assert.equal(safeFileName("../../evil name.dmg"), "evil_name.dmg");
    assert.equal(safeFileName("..."), "pi-pocket-gui-update.dmg");
});

test("a download keeps its name only when its checksum matches", async () => {
    const { mkdtempSync, existsSync, readdirSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { createHash } = await import("node:crypto");
    const { downloadChecked } = await import("../main/download");
    const folder = mkdtempSync(join(tmpdir(), "gui-dl-"));
    const body = "disk image bytes";
    const good = createHash("sha256").update(body).digest("hex");
    const fetch = async () => new Response(body, { headers: { "content-length": String(body.length) } });
    const seen: number[] = [];
    const path = await downloadChecked({ url: "u", name: "a.dmg", folder, sha256: good, fetch, onProgress: (p) => seen.push(p) });

    assert.equal(existsSync(path), true);
    assert.equal(seen.at(-1), 100);
    await assert.rejects(downloadChecked({ url: "u", name: "b.dmg", folder, sha256: "0".repeat(64), fetch }), /checksum/);
    assert.deepEqual(readdirSync(folder).sort(), ["a.dmg"]);
    await assert.rejects(downloadChecked({ url: "u", name: "c.dmg", folder, fetch: async () => new Response("", { status: 404 }) }), /404/);
});
