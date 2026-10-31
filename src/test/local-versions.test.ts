import { strict as assert } from "node:assert";
import { cause } from "../main/local-server";
import { test } from "node:test";
import { cleanLine, compareVersions, pickNode, runtimePaths, satisfies, shasumFor, signInLine } from "../main/local-versions";
import { validateSettings } from "../main/settings";

test("satisfies reads the engines ranges packages write", () => {
    assert.equal(satisfies("v22.19.0", ">=22.19"), true);
    assert.equal(satisfies("22.18.9", ">=22.19"), false);
    assert.equal(satisfies("26.13.0", ">=22.19"), true);
    assert.equal(satisfies("20.11.0", "^20.10 || >=22"), true);
    assert.equal(satisfies("21.0.0", "^20.10 || >=22"), false);
    assert.equal(satisfies("24.1.0", ">=22.19 <25"), true);
    assert.equal(satisfies("25.0.0", ">=22.19 <25"), false);
    assert.equal(satisfies("22.5.1", "~22.5"), true);
    assert.equal(satisfies("22.6.0", "~22.5"), false);
    assert.equal(satisfies("24.0.0", "24.x"), true);
    assert.equal(satisfies("24.0.0", "*"), true);
    assert.equal(satisfies("24.0.0", "not a range"), false);
});

test("compareVersions orders by number, not text", () => {
    assert.ok(compareVersions("0.27.10", "0.27.9") > 0);
    assert.equal(compareVersions("v24.22.2", "24.22.2"), 0);
});

const releases = [
    { version: "v27.0.0", lts: false as const, files: ["linux-x64", "osx-arm64-tar", "win-x64-zip"] },
    { version: "v26.13.0", lts: "Lithium", files: ["linux-x64", "osx-arm64-tar", "osx-x64-tar", "win-x64-zip", "win-arm64-zip"] },
    { version: "v24.22.2", lts: "Krypton", files: ["linux-x64", "linux-arm64", "osx-arm64-tar", "osx-x64-tar", "win-x64-zip"] },
    { version: "v22.18.0", lts: "Jod", files: ["linux-x64", "linux-arm64", "osx-arm64-tar", "win-x64-zip"] },
];

test("pickNode takes the newest LTS that fits, with an archive for this computer", () => {
    assert.deepEqual(pickNode(releases, ">=22.19", "darwin", "arm64"), {
        version: "26.13.0",
        file: "node-v26.13.0-darwin-arm64.tar.xz",
        url: "https://nodejs.org/dist/v26.13.0/node-v26.13.0-darwin-arm64.tar.xz",
        folder: "node-v26.13.0-darwin-arm64",
    });
    // 26 has no linux-arm64 build in this list: the newest that has one.
    assert.equal(pickNode(releases, ">=22.19", "linux", "arm64")?.file, "node-v24.22.2-linux-arm64.tar.gz");
    assert.equal(pickNode(releases, ">=22.19 <25", "win32", "x64")?.file, "node-v24.22.2-win-x64.zip");
    assert.equal(pickNode(releases, ">=28", "linux", "x64"), undefined);
    assert.equal(pickNode(releases, ">=22.19", "linux", "ia32"), undefined);
});

test("shasumFor finds one file's checksum", () => {
    const sums = [
        `${"a".repeat(64)}  node-v24.22.2-darwin-arm64.tar.gz`,
        `${"b".repeat(64)}  node-v24.22.2-darwin-arm64.tar.xz`,
    ].join("\n");

    assert.equal(shasumFor(sums, "node-v24.22.2-darwin-arm64.tar.xz"), "b".repeat(64));
    assert.equal(shasumFor(sums, "node-v24.22.2-linux-x64.tar.gz"), undefined);
});

test("runtimePaths follow each system's Node.js layout", () => {
    const unix = runtimePaths("/r", "linux");
    const windows = runtimePaths("C:\\r", "win32");

    assert.equal(unix.node, "/r/bin/node");
    assert.equal(unix.launcher, "/r/lib/node_modules/pi-pocket/bin/pi-pocket.js");
    assert.ok(windows.node.endsWith("node.exe"));
    assert.ok(windows.launcher.replaceAll("\\", "/").endsWith("node_modules/pi-pocket/bin/pi-pocket.js"));
    assert.ok(!windows.launcher.includes("lib"));
});

test("signInLine reads the launcher's panel line, with or without colors", () => {
    assert.deepEqual(signInLine("  Sign in  http://127.0.0.1:8797/login?token=abc123"), {
        url: "http://127.0.0.1:8797/login?token=abc123",
        origin: "http://127.0.0.1:8797",
        loginPath: "/login?token=abc123",
    });
    assert.equal(signInLine("  \u001b[2mSign in  \u001b[22mhttp://100.64.1.2:8787/login?token=x")?.origin, "http://100.64.1.2:8787");
    assert.equal(signInLine("  Open     http://127.0.0.1:8787"), undefined);
    assert.equal(signInLine("  Sign in  http://127.0.0.1:8787/elsewhere"), undefined);
});

test("cleanLine hides login tokens and colors", () => {
    assert.equal(cleanLine("\u001b[32m  Sign in  http://h/login?token=secret&next=/\u001b[0m  "), "  Sign in  http://h/login?token=…&next=/");
});

test("old config files keep opening their server; new ones run Pi Pocket here", () => {
    assert.equal(validateSettings({ server: { url: "http://10.0.0.2:8787" } }).settings.server.mode, "remote");
    assert.equal(validateSettings(undefined).settings.server.mode, "local");
    assert.equal(validateSettings({ server: { mode: "local", url: "http://a:1" } }).settings.server.mode, "local");

    const checked = validateSettings({ local: { folder: "relative/path", port: 80, access: "everyone" } });

    assert.deepEqual(
        checked.problems.map((problem) => problem.path),
        ["local.folder", "local.port", "local.access"],
    );
});

test("cause keeps what went wrong in the last start, in the app's words", () => {
    const lines = [
        "— 2026-10-31T05:00:00.000Z Pi Pocket 0.27.0, Node.js 26.13.0",
        "  old trouble",
        "— 2026-10-31T05:21:09.196Z Pi Pocket 0.27.0, Node.js 26.13.0",
        "  Starting Pi Pocket (This device only)…",
        "Port 8897 is already in use on 127.0.0.1. Is Pi Pocket already running? Pick another with --port.",
        "  Pi Pocket could not start (see above).",
        "  Stopping Pi Pocket…",
    ];

    assert.equal(cause(lines), "Port 8897 is already in use on 127.0.0.1. Is Pi Pocket already running? Pick another port below.");
});
