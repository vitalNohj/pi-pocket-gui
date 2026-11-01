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
        assert.match(state.message ?? "", /no runner/);
        assert.deepEqual(state.link, { server: "https://pocket.example", id: "a", name: "Mac" });
        assert.equal(JSON.stringify(state).includes("secret"), false, "the key never leaves the file");
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});

test("linking installs Pi Pocket first when no runtime has the runner, and says so when it still has none", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    let prepared = 0;

    try {
        const runner = setUpRunner(host(home, { prepare: async () => { prepared++; } }));

        await assert.rejects(runner.linkTo("https://pocket.example", "ABCD-EFGH-JKLM"), /no runner yet/);
        assert.equal(prepared, 1);
        assert.equal(runner.state().busy, undefined);
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
});
