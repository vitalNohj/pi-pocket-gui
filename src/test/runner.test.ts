import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computerName, setUpRunner, type RunnerConfirmation, type RunnerHost } from "../main/runner";
import { validateSettings } from "../main/settings";

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
        confirmSessions: () => true,
        ask: async () => false,
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

/** A stand-in launcher: links, saves confirmation choices, and records its arguments and stdin. */
function fakeRuntime(
    home: string,
    options: { script?: string; confirmError?: string; legacyError?: string } = {},
): { node: string; launcher: string; bin: string } {
    const launcher = join(home, "fake-launcher.mjs");

    writeFileSync(
        launcher,
        `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const args = process.argv.slice(2);
const file = args[args.indexOf("--config") + 1];
const record = (name, line) => appendFileSync(${JSON.stringify(home)} + "/" + name, line + "\\n");
record("calls.jsonl", JSON.stringify(args));
if (args[1] === "link") {
    if (args[3] === "BAD-CODE") { console.error("pi-pocket runner: refused the code"); process.exit(1); }
    writeFileSync(file, JSON.stringify({ server: args[2], id: "id", name: "Mac", key: "k" }));
    console.log("Linked.");
} else if (args[1] === "settings" && args[2] === "confirm") {
    const error = ${JSON.stringify(options.confirmError ?? "")};
    if (error) { console.error(error); process.exit(1); }
    const link = JSON.parse(readFileSync(file, "utf8"));
    link.confirmSessions = args[3] === "on";
    writeFileSync(file, JSON.stringify(link));
    console.log("confirm " + args[3]);
} else {
    const error = ${JSON.stringify(options.legacyError ?? "")};
    if (error && args.includes("--confirm-via")) { console.error(error); process.exit(1); }
    console.log("[00:00:00] Connected to server as Mac.");
    createInterface({ input: process.stdin }).on("line", line => record("answers.jsonl", line));
    process.on("SIGTERM", () => process.exit(0));
    ${options.script ?? ""}
}
`,
    );

    return { node: process.execPath, launcher, bin: home };
}

function recorded(home: string, file: string): string[] {
    const path = join(home, file);

    return existsSync(path) ? readFileSync(path, "utf8").trimEnd().split("\n") : [];
}

function calls(home: string): string[][] {
    return recorded(home, "calls.jsonl").map((line) => JSON.parse(line) as string[]);
}

const request: RunnerConfirmation = {
    id: 7,
    server: "http://100.1.2.3:8787",
    computer: "MacBook",
    person: "Owner",
    folder: "/Users/me/project",
    kind: "new",
};

const confirmLine = (value: RunnerConfirmation) => `console.log(${JSON.stringify(`PI-POCKET-CONFIRM ${JSON.stringify(value)}`)});`;
const endLine = (id: number) => `console.log(${JSON.stringify(`PI-POCKET-CONFIRM-END ${JSON.stringify({ id })}`)});`;

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

test("confirmation is on by default, including old config files, and checks boolean values", () => {
    for (const input of [undefined, { runner: { enabled: false } }]) {
        const result = validateSettings(input);

        assert.equal(result.settings.runner.confirmSessions, true);
        assert.deepEqual(result.problems, []);
    }

    assert.equal(validateSettings({ runner: { confirmSessions: false } }).settings.runner.confirmSessions, false);
    const invalid = validateSettings({ runner: { confirmSessions: "off" } });

    assert.equal(invalid.settings.runner.confirmSessions, true);
    assert.deepEqual(invalid.problems, [{ path: "runner.confirmSessions", message: "must be true or false" }]);
});

test("the runner always gets --confirm-via stdio and replies with one JSON line on stdin", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home, { script: confirmLine(request) });
    const asked: RunnerConfirmation[] = [];
    const runner = setUpRunner(host(home, {
        runtime: () => runtime,
        ask: async (value, signal) => {
            assert.equal(signal.aborted, false);
            asked.push(value);

            return true;
        },
    }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => recorded(home, "answers.jsonl").length === 1, "answer on stdin");
        assert.deepEqual(asked, [request]);
        assert.deepEqual(calls(home).find((args) => args[1] === "--confirm-via"), [
            "runner", "--confirm-via", "stdio", "--config", join(home, "runner.json"),
        ]);
        assert.equal(readFileSync(join(home, "answers.jsonl"), "utf8"), '{"id":7,"allow":true}\n');
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("questions wait for the previous answer, including forks and denials", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const fork = { ...request, id: 8, kind: "fork" as const };
    const runtime = fakeRuntime(home, { script: `${confirmLine(request)}\n${confirmLine(fork)}` });
    const asked: RunnerConfirmation[] = [];
    let answer: ((allow: boolean) => void) | undefined;
    const runner = setUpRunner(host(home, {
        runtime: () => runtime,
        ask: (value) => {
            asked.push(value);

            return new Promise((resolve) => { answer = resolve; });
        },
    }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => asked.length === 1, "first question");
        assert.deepEqual(asked, [request]);
        answer!(false);
        await until(() => asked.length === 2, "second question");
        assert.deepEqual(asked, [request, fork]);
        answer!(true);
        await until(() => recorded(home, "answers.jsonl").length === 2, "both answers");
        assert.deepEqual(recorded(home, "answers.jsonl"), ['{"id":7,"allow":false}', '{"id":8,"allow":true}']);
    } finally {
        answer?.(false);
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("CONFIRM-END cancels an open question, skips ended queued questions, and ignores late Allow", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home, { script: [
        confirmLine(request),
        confirmLine({ ...request, id: 8 }),
        confirmLine({ ...request, id: 9 }),
        endLine(8),
        endLine(7),
    ].join("\n") });
    const asked: number[] = [];
    let canceled = false;
    const runner = setUpRunner(host(home, {
        runtime: () => runtime,
        ask: async (value, signal) => {
            asked.push(value.id);

            if (value.id === 7) {
                await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
                    canceled = true;
                    resolve();
                }, { once: true }));
            }

            return true;
        },
    }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => recorded(home, "answers.jsonl").length === 1, "only the live request answered");
        assert.equal(canceled, true);
        assert.deepEqual(asked, [7, 9]);
        assert.deepEqual(recorded(home, "answers.jsonl"), ['{"id":9,"allow":true}']);
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("stopping the runner closes its question and drops a late answer", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home, { script: confirmLine(request) });
    let signal: AbortSignal | undefined;
    let answer: ((allow: boolean) => void) | undefined;
    const runner = setUpRunner(host(home, {
        runtime: () => runtime,
        ask: (_value, nextSignal) => {
            signal = nextSignal;

            return new Promise((resolve) => { answer = resolve; });
        },
    }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => signal !== undefined, "question");
        await runner.quit();
        assert.equal(signal!.aborted, true);
        answer!(true);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(recorded(home, "answers.jsonl"), []);
    } finally {
        answer?.(false);
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("a failed question denies rather than allowing or crashing", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home, { script: confirmLine(request) });
    const runner = setUpRunner(host(home, {
        runtime: () => runtime,
        ask: async () => { throw new Error("dialog unavailable"); },
    }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => recorded(home, "answers.jsonl").length === 1, "denial");
        assert.deepEqual(recorded(home, "answers.jsonl"), ['{"id":7,"allow":false}']);
        assert.ok(runner.state().log.some((line) => line.includes("dialog unavailable")));
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("settings confirm on|off runs after linking, on setting changes, and before starts without a live restart", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home);
    let confirm = true;
    const runner = setUpRunner(host(home, { runtime: () => runtime, confirmSessions: () => confirm }));
    const choices = () => calls(home).filter((args) => args[1] === "settings" && args[2] === "confirm");
    const starts = () => calls(home).filter((args) => args[1] === "--confirm-via");

    try {
        confirm = false;
        await runner.confirmChanged();
        assert.deepEqual(calls(home), [], "a preference can be set before linking, without an error");
        assert.equal(runner.state().confirmError, undefined);
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => runner.state().status === "connected", "connected");
        assert.ok(choices().length > 0);
        assert.ok(choices().every((args) => args[3] === "off"));
        assert.ok(choices().every((args) => args.slice(4).join(" ") === `--config ${join(home, "runner.json")}`));
        assert.ok(calls(home).findIndex((args) => args[1] === "settings") < calls(home).findIndex((args) => args[1] === "--confirm-via"));

        confirm = true;
        await runner.confirmChanged();
        assert.equal(choices().at(-1)?.[3], "on");
        confirm = false;
        await runner.confirmChanged();
        assert.equal(choices().at(-1)?.[3], "off");
        assert.equal(starts().length, 1, "the running runner did not restart for a setting change");
        assert.equal(runner.state().status, "connected");
        assert.equal((JSON.parse(readFileSync(join(home, "runner.json"), "utf8")) as { confirmSessions: boolean }).confirmSessions, false);

        const before = choices().length;

        await runner.restart();
        await until(() => runner.state().status === "connected", "connected again");
        assert.equal(starts().length, 2);
        assert.equal(choices().length, before + 1);
        assert.equal(choices().at(-1)?.[3], "off");
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

test("a failed settings confirm command is in the runner log and card even when connected", async () => {
    const home = mkdtempSync(join(tmpdir(), "runner-"));
    const runtime = fakeRuntime(home, { confirmError: "pi-pocket runner: link is read-only" });
    const runner = setUpRunner(host(home, { runtime: () => runtime }));

    try {
        await runner.linkTo("https://pocket.example", "GOOD-CODE");
        await until(() => runner.state().status === "connected", "connected");
        assert.match(runner.state().confirmError ?? "", /Could not set session confirmation: link is read-only/);
        assert.ok(runner.state().log.some((line) => line.includes("link is read-only")));
    } finally {
        await runner.quit();
        rmSync(home, { recursive: true, force: true });
    }
});

for (const legacyError of ['Unknown option "--confirm-via"', "unknown command: confirm-via"]) {
    test(`an old runner retries without the flag after ${legacyError}`, async () => {
        const home = mkdtempSync(join(tmpdir(), "runner-"));
        const runtime = fakeRuntime(home, { legacyError, confirmError: "unknown command: settings" });
        const runner = setUpRunner(host(home, { runtime: () => runtime }));

        try {
            await runner.linkTo("https://pocket.example", "GOOD-CODE");
            await until(() => runner.state().status === "connected", "legacy connection");
            const starts = calls(home).filter((args) => args[1] === "--confirm-via" || args[1] === "--config");

            assert.equal(starts.length, 2);
            assert.ok(starts[0]?.includes("--confirm-via"));
            assert.deepEqual(starts[1], ["runner", "--config", join(home, "runner.json")]);
            assert.equal(runner.state().log.filter((line) => line.includes("retrying without the flag")).length, 1);
            assert.match(runner.state().confirmError ?? "", /unknown command: settings/);
        } finally {
            await runner.quit();
            rmSync(home, { recursive: true, force: true });
        }
    });
}

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
