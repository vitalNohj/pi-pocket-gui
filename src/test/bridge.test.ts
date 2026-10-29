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
