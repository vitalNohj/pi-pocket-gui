import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { DEFAULT_THEME, THEME_TOKENS } from "../main/theme";
import type { ThemeColors } from "../shared/types";

/** Run the actual sandboxed preload, without Electron, and deliver its DOM/style/load events explicitly. */
function page(initial: Record<string, string>) {
    let colors = initial;
    let painted = "";
    let probes = 0;
    const messages: ThemeColors[] = [];
    const listeners = new Map<string, () => void>();
    const observers: (() => void)[] = [];
    const timers = new Map<number, () => void>();
    const root = { dataset: { mode: "dark" }, append: () => probes++ };
    const paint = {
        clearRect: () => undefined,
        fillStyle: "",
        fillRect: () => { painted = paint.fillStyle; },
        getImageData: () => ({ data: [...[1, 3, 5].map((at) => Number.parseInt(painted.slice(at, at + 2), 16)), 255] }),
    };

    runInNewContext(readFileSync(join(__dirname, "..", "preload", "server.js"), "utf8"), {
        exports: {},
        require: (name: string) => {
            assert.equal(name, "electron");

            return {
                contextBridge: { exposeInMainWorld: () => undefined },
                ipcRenderer: {
                    sendSync: () => ({ visible: true }),
                    on: () => undefined,
                    send: (channel: string, theme: ThemeColors) => {
                        assert.equal(channel, "host:theme");
                        messages.push(JSON.parse(JSON.stringify(theme)) as ThemeColors);
                    },
                },
            };
        },
        document: {
            documentElement: root,
            head: {},
            readyState: "loading",
            addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
            createElement: (tag: string) => tag === "canvas"
                ? { getContext: () => paint }
                : { style: { color: "", display: "" }, remove: () => probes-- },
        },
        getComputedStyle: (element: { style?: { color: string } }) => ({
            getPropertyValue: (name: string) => colors[name.slice(2)] ?? "",
            // Missing/invalid var() becomes inherited black: the regression this harness reproduces.
            color: colors[element.style?.color.slice(6, -1) ?? ""] ?? "#000000",
        }),
        CSS: { supports: (_property: string, value: string) => value !== "invalid" },
        MutationObserver: class {
            constructor(callback: () => void) { observers.push(callback); }
            observe() {}
        },
        setTimeout: (callback: () => void) => {
            const id = timers.size + 1;

            timers.set(id, callback);

            return id;
        },
        clearTimeout: (id: number) => timers.delete(id),
    });
    listeners.get("DOMContentLoaded")!();

    return {
        messages,
        probes: () => probes,
        change: (next: Record<string, string>, event: "mutation" | "load" = "mutation") => {
            colors = next;

            if (event === "load") {
                listeners.get("load")!();
            } else {
                observers.forEach((callback) => callback());
            }

            const pending = [...timers.values()];

            timers.clear();
            pending.forEach((callback) => callback());
        },
    };
}

test("a non-Pi-Pocket page never sends inherited black as a theme", () => {
    const loaded = page({});

    assert.deepEqual(loaded.messages, []);
    assert.equal(loaded.probes(), 0);
});

test("every theme variable must exist and be a color before sampling", () => {
    for (const token of THEME_TOKENS) {
        for (const value of ["", "   ", "invalid"]) {
            const loaded = page({ ...DEFAULT_THEME.colors, [token]: value });

            assert.deepEqual(loaded.messages, [], token);
            assert.equal(loaded.probes(), 0);
        }
    }
});

test("a complete palette is sampled once, with no probe left behind", () => {
    const loaded = page(DEFAULT_THEME.colors);

    assert.deepEqual(loaded.messages, [DEFAULT_THEME]);
    assert.equal(loaded.probes(), 0);
    loaded.change(DEFAULT_THEME.colors);
    assert.equal(loaded.messages.length, 1);
});

test("a theme stylesheet that loads later is still followed", () => {
    const loaded = page({});

    loaded.change(DEFAULT_THEME.colors, "load");
    assert.deepEqual(loaded.messages, [DEFAULT_THEME]);
    loaded.change({});
    assert.equal(loaded.messages.length, 1);

    const changed = { ...DEFAULT_THEME.colors, accent: "#ff8866" };

    loaded.change(changed);
    assert.deepEqual(loaded.messages[1], { mode: "dark", colors: changed });
});
