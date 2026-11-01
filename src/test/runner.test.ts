import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computerName, setUpRunner, type RunnerHost } from "../main/runner";

test("a computer's name drops macOS's .local and a domain", () => {
    assert.equal(computerName("Johns-MacBook-Pro.local"), "Johns MacBook Pro");
    assert.equal(computerName("opti-nohj.tail1234.ts.net"), "opti nohj");
    assert.equal(computerName(""), "This computer");
});

function host(home: string, overrides: Partial<RunnerHost> = {}): RunnerHost {
    let enabled = true;

    return {
        home,
        platform: process.platform,
        enabled: () => enabled,
        setEnabled: async (next) => {
            enabled = next;
        },
        runtime: () => undefined,
        prepare: async () => {},
        environment: async () => ({ ...process.env }),
        changed: () => {},
        ...overrides,
    };
}

test("without a link it is unlinked, and with one but no runtime it says what to do", () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));

    try {
        const runner = setUpRunner(host(home));

        runner.boot();
        assert.equal(runner.state().status, "unlinked");
        assert.equal(runner.state().link, undefined);

        writeFileSync(join(home, "runner.json"), JSON.stringify({ server: "https://pocket.example", id: "a", name: "Mac", key: "secret" }));
        runner.boot();

        const state = runner.state();

        assert.equal(state.status, "failed");
        assert.match(state.message ?? "", /Install or update Pi Pocket under This computer in Connection/);
        assert.deepEqual(state.link, { server: "https://pocket.example", id: "a", name: "Mac" });
        assert.equal(JSON.stringify(state).includes("secret"), false, "the key never leaves the file");
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

/** A stand-in launcher: `runner link` writes the link (or fails for code BAD), `runner` connects and waits. */
function fakeRuntime(home: string): { node: string; launcher: string; bin: string } {
    const launcher = join(home, "fake-launcher.mjs");

    writeFileSync(
        launcher,
        `import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const file = args[args.indexOf("--config") + 1];
if (args[1] === "link") {
    if (args[3] === "BAD-CODE") { console.error("pi-pocket runner: refused the code"); process.exit(1); }
    writeFileSync(file, JSON.stringify({ server: args[2], id: "id", name: "Mac", key: "k" }));
    console.log("Linked.");
} else {
    console.log("[00:00:00] Connected to " + "server" + " as Mac.");
    process.on("SIGTERM", () => process.exit(0));
    setInterval(() => {}, 1000);
}
`,
    );

    return { node: process.execPath, launcher, bin: home };
}

async function until(check: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (check()) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.fail(`timed out waiting for ${what}`);
}

test("off and on again quickly while it stops: it runs again, as the setting says", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    let enabled = true;
    const runtime = fakeRuntime(home);
    const runner = setUpRunner(host(home, { enabled: () => enabled, setEnabled: async (next) => { enabled = next; }, runtime: () => runtime }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => runner.state().status === "connected", "connected");

        enabled = false;
        runner.enabledChanged();
        enabled = true;
        runner.enabledChanged();

        await until(() => runner.state().status === "connected", "connected again");
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("a failed link keeps the link before running", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home);
    const runner = setUpRunner(host(home, { runtime: () => runtime }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => runner.state().status === "connected", "connected");
        await assert.rejects(runner.linkTo("https://other.example", "BAD-CODE"), /refused the code/);
        await until(() => runner.state().status === "connected", "connected again");
        assert.equal(runner.state().link?.server, "https://pocket.example");
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("linking installs Pi Pocket first when no runtime has the runner, and says so when it still has none", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    let prepared = 0;

    try {
        const runner = setUpRunner(host(home, { prepare: async () => { prepared++; } }));

        await assert.rejects(runner.linkTo("https://pocket.example", "ABCD-EFGH-JKLM"), /The runner is not available\. Update Pi Pocket/);
        assert.equal(prepared, 1);
        assert.equal(runner.state().busy, undefined);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
