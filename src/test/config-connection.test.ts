import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { mayConnect } from "../main/connection";
import { defaultSettings } from "../main/settings";
import { DEFAULT_THEME } from "../main/theme";
import type { ConfigState, ProbeResult } from "../shared/types";

const url = "https://example.com/pocket";
const found: ProbeResult = { kind: "detected", url, bridge: 1, via: "info" };
const apiError: ProbeResult = { kind: "other", url, status: 404, message: "Use the web interface, not an API endpoint.", canOpen: false };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Run the actual built renderer. Only its DOM and IPC boundary are stubbed, not its connection logic. */
async function page(probe: (input: string) => Promise<ProbeResult>, initial: Partial<ConfigState> = {}) {
    const makeElement = () => ({
        value: "", textContent: "", hidden: false, disabled: false, checked: false, title: "",
        dataset: {} as Record<string, string>,
        firstElementChild: { style: { width: "" } },
        style: { setProperty() {} },
        classList: { toggle() {} },
        listeners: new Map<string, (event: { preventDefault(): void }) => void>(),
        addEventListener(name: string, listener: (event: { preventDefault(): void }) => void) { this.listeners.set(name, listener); },
        fire(name: string) { this.listeners.get(name)?.({ preventDefault() {} }); },
        querySelectorAll: () => [],
        replaceChildren() {},
    });
    const html = readFileSync(join(__dirname, "..", "renderer", "config", "index.html"), "utf8");
    const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1]!, makeElement()]));
    const element = (id: string) => { const node = nodes.get(id); assert.ok(node, `Missing #${id}`); return node; };
    const radio = { ...makeElement(), value: "url", checked: true };
    const parts = { ...makeElement(), value: "parts" };
    const translucent = makeElement(), opacity = makeElement();
    // These tests are about another server: remote mode, with this computer's Pi Pocket not installed.
    const remote = defaultSettings();
    remote.server.mode = "remote";
    let state: ConfigState = {
        settings: remote, defaults: defaultSettings(), problems: [], configPath: "/test/config.json",
        reason: { kind: "first-run" }, canReturn: false, recovery: false, trayAvailable: true,
        translucency: { kind: "live", blur: "system" }, translucentAtStart: false,
        titleBarAtStart: "seamless", theme: DEFAULT_THEME, platform: "win32", appVersion: "test",
        update: { method: "source", status: "idle" },
        local: { status: "absent", log: [], restartNeeded: false, update: { status: "idle" }, defaults: { folder: "/home/test", data: "/home/test/.pi-pocket" }, home: "/test/server" },
        dictation: { supported: true, status: "idle", engine: { installed: false, size: 11e6 }, folder: "/test/dictation", models: [], downloading: false },
        billionContext: { server: "absent", foreign: false, updateAvailable: false, folder: "/home/test/.pi-pocket/extensions", page: "https://github.com/x/y", command: "cd" },
        ...initial,
    };
    let render: (next: ConfigState) => void = () => undefined;
    let settingsOpened = 0;
    const connections: { url: string; unverified: boolean }[] = [];
    const gui = {
        state: async () => state,
        probe,
        onState: (listener: typeof render) => { render = listener; },
        onFocus: () => () => {},
        openSettings: async () => { settingsOpened++; state = { ...state, recovery: false }; render(state); },
        connect: async (input: string, unverified = false) => {
            connections.push({ url: input, unverified });
            const result = await probe(input);

            if (mayConnect(result, unverified)) {
                state = { ...state, settings: { ...state.settings, server: { ...state.settings.server, url: result.url } },
                    probe: result, connectedUrl: result.url, canReturn: true, recovery: result.kind !== "detected", reason: { kind: "user" } };
            } else {
                state = { ...state, reason: { kind: "not-detected", probe: result } };
            }

            render(state);
            return result;
        },
    };
    const source = readFileSync(join(__dirname, "..", "renderer", "config", "main.js"), "utf8").replace(/^export \{\};?\s*$/m, "");

    runInNewContext(source, {
        URL,
        window: { gui, clearInterval() {}, setInterval() {}, clearTimeout() {}, setTimeout() {} },
        document: {
            documentElement: makeElement(), body: makeElement(), getElementById: (id: string) => element(id),
            querySelectorAll: (selector: string) => selector === 'input[name="mode"]' ? [radio, parts] : [],
            querySelector: (selector: string) => selector.includes('name="mode"') ? radio : selector.includes("translucent") ? translucent : opacity,
        },
    });
    await flush();

    return {
        element, connections, settingsOpened: () => settingsOpened,
        input: (input: string) => { element("url").value = input; element("url").fire("input"); },
        submit: async () => { element("connect-form").fire("submit"); await flush(); },
        click: async (id: string) => { element(id).fire("click"); await flush(); },
    };
}

test("first-run Connect does not open a JSON API error, invalid URL, or unreachable server", async () => {
    for (const result of [apiError, { kind: "invalid", url, message: "Invalid" }, { kind: "unreachable", url, message: "Offline" }] satisfies ProbeResult[]) {
        const screen = await page(async () => result);

        screen.input(url);
        await screen.submit();
        assert.equal(screen.connections.length, 0);
        assert.equal(screen.element("connect").disabled, true);
        assert.equal(screen.element("url").value, url);
        assert.equal(screen.element("status").textContent, "Not detected");
    }
});

test("a detected server connects and is shown as Connected, not merely Detected", async () => {
    const screen = await page(async () => found);

    screen.input(url);
    await screen.submit();
    assert.deepEqual(screen.connections, [{ url, unverified: false }]);
    assert.equal(screen.element("status").textContent, "Connected");
});

test("an unknown HTML page needs an explicit second click and exposes an app-owned settings button", async () => {
    const screen = await page(async () => ({ ...apiError, status: 200, canOpen: true }));

    screen.input(url);
    await screen.submit();
    assert.equal(screen.connections.length, 0);
    assert.equal(screen.element("connect").textContent, "Open webpage anyway");
    await screen.submit();
    assert.deepEqual(screen.connections, [{ url, unverified: true }]);
    assert.equal(screen.element("recovery").hidden, false);
    assert.equal(screen.element("settings-page").hidden, true);
    await screen.click("server-settings");
    assert.equal(screen.settingsOpened(), 1);
    assert.equal(screen.element("settings-page").hidden, false);
});

test("a late check result cannot connect after the person edits the address", async () => {
    let resolve!: (result: ProbeResult) => void;
    const screen = await page(() => new Promise<ProbeResult>((done) => { resolve = done; }));

    screen.input(url);
    await screen.submit();
    screen.input("https://example.com/something-else");
    resolve(found);
    await flush();
    assert.equal(screen.connections.length, 0);
    assert.equal(screen.element("url").value, "https://example.com/something-else");
    assert.equal(screen.element("connect").textContent, "Connect");
});

test("a saved address already known to be wrong has no enabled Connect button", async () => {
    const settings = defaultSettings();

    settings.server.mode = "remote";
    settings.server.url = url;
    const screen = await page(async () => apiError, { settings, probe: apiError });

    assert.equal(screen.element("connect").disabled, true);
    await screen.submit();
    assert.equal(screen.connections.length, 0);
});

test("a failed replacement check keeps Back to the existing server available", async () => {
    const screen = await page(async () => apiError, { connectedUrl: "https://example.com/working", canReturn: true, reason: { kind: "user" } });

    screen.input(url);
    await screen.click("test");
    assert.equal(screen.element("back").hidden, false);
    assert.equal(screen.element("connect").disabled, true);
    assert.equal(screen.connections.length, 0);
});
