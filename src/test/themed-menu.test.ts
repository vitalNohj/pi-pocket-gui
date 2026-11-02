import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { MenuItemConstructorOptions } from "electron";
import { contextMenuTemplate, type ClickInfo } from "../main/context-menu";
import { DEFAULT_THEME } from "../main/theme";
import {
    acceleratorHint,
    eventCovered,
    menuKey,
    menuScript,
    menuSheet,
    menuStep,
    pageClickInfo,
    pickScript,
    placeMenu,
    readPageClick,
    runPicked,
    themedGroups,
} from "../main/themed-menu";

const flags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };

function click(over: Partial<ClickInfo>): ClickInfo {
    return { misspelledWord: "", dictionarySuggestions: [], isEditable: false, selectionText: "", editFlags: flags, ...over };
}

const noSpelling = { replace: () => undefined, learn: () => undefined };
const lines = (template: MenuItemConstructorOptions[], mac = false) =>
    themedGroups(template, mac).map((group) => group.map((item) => `${item.label}${item.hint === undefined ? "" : ` ${item.hint}`}${item.enabled ? "" : " (off)"}`));

test("the drawn menu is contextMenuTemplate's: same items, same order, same groups, same enabled lines", () => {
    const template = contextMenuTemplate(
        click({ isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the", "tea"], editFlags: { ...flags, canPaste: false } }),
        { ...noSpelling, openSettings: () => undefined },
    );

    assert.deepEqual(lines(template), [
        ["the", "tea", "Add “teh” to dictionary"],
        ["Cut Ctrl+X", "Copy Ctrl+C", "Paste Ctrl+V (off)"],
        ["Select All Ctrl+A"],
        ["GUI Settings… Ctrl+,"],
    ]);
    // Every line is the template's item at that index, so a pick runs the template's own item.
    for (const item of themedGroups(template, false).flat()) {
        assert.equal(template[item.id]!.label ?? template[item.id]!.role, template[item.id]!.label ?? template[item.id]!.role);
        assert.notEqual(template[item.id]!.type, "separator");
    }
});

test("outside a text field only Copy, then GUI Settings; a pop-out window has no GUI Settings", () => {
    assert.deepEqual(lines(contextMenuTemplate(click({ selectionText: "hi" }), { ...noSpelling, openSettings: () => undefined })), [
        ["Copy Ctrl+C"],
        ["GUI Settings… Ctrl+,"],
    ]);
    assert.deepEqual(lines(contextMenuTemplate(click({}), noSpelling)), [["Copy Ctrl+C (off)"]]);
    assert.deepEqual(lines(contextMenuTemplate(click({ isEditable: true, misspelledWord: "qzxv" }), noSpelling)), [
        ["No suggestions (off)", "Add “qzxv” to dictionary"],
        ["Cut Ctrl+X", "Copy Ctrl+C", "Paste Ctrl+V"],
        ["Select All Ctrl+A"],
    ]);
});

test("macOS shows the command key", () => {
    const template = contextMenuTemplate(click({ isEditable: true }), { ...noSpelling, openSettings: () => undefined });

    assert.deepEqual(lines(template, true), [["Cut ⌘X", "Copy ⌘C", "Paste ⌘V"], ["Select All ⌘A"], ["GUI Settings… ⌘,"]]);
    assert.equal(acceleratorHint("CommandOrControl+,", true), "⌘,");
    assert.equal(acceleratorHint("CommandOrControl+,", false), "Ctrl+,");
    assert.equal(acceleratorHint("CommandOrControl+Shift+Z", true), "⌘⇧Z");
    assert.equal(acceleratorHint("CommandOrControl+Shift+Z", false), "Ctrl+Shift+Z");
});

test("a pick runs the template's item: its click, or the web contents' edit command for a role", () => {
    const ran: string[] = [];
    const template = contextMenuTemplate(click({ isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the"] }), {
        replace: (word) => ran.push(`replace ${word}`),
        learn: (word) => ran.push(`learn ${word}`),
        openSettings: () => ran.push("settings"),
    });
    const edit = { cut: () => ran.push("cut"), copy: () => ran.push("copy"), paste: () => ran.push("paste"), selectAll: () => ran.push("selectAll") };
    const id = (label: string) => themedGroups(template, false).flat().find((item) => item.label === label)!.id;

    for (const label of ["the", "Add “teh” to dictionary", "Cut", "Copy", "Paste", "Select All", "GUI Settings…"]) {
        runPicked(template, id(label), edit);
    }

    assert.deepEqual(ran, ["replace the", "learn teh", "cut", "copy", "paste", "selectAll", "settings"]);
});

test("nothing runs for no pick, a separator, a disabled line, or an id the page made up", () => {
    let ran = 0;
    const template = contextMenuTemplate(click({ isEditable: true, misspelledWord: "x", editFlags: { ...flags, canCut: false } }), {
        replace: () => ran++,
        learn: () => ran++,
        openSettings: () => ran++,
    });
    const edit = { cut: () => ran++, copy: () => ran++, paste: () => ran++, selectAll: () => ran++ };

    for (const id of [null, undefined, -1, 1.5, "0", template.length, template.findIndex((item) => item.type === "separator")]) {
        runPicked(template, id, edit);
    }

    runPicked(template, template.findIndex((item) => item.label === "No suggestions"), edit);
    runPicked(template, template.findIndex((item) => item.role === "cut"), edit);
    assert.equal(ran, 0);
});

test("a page's own report (macOS): the template's rules, from what the page knows", () => {
    assert.equal(readPageClick({ x: 1, y: 2, isEditable: true }), undefined);
    assert.equal(readPageClick({ x: Number.NaN, y: 2, isEditable: true, selectionText: "" }), undefined);
    assert.equal(readPageClick("click"), undefined);

    const field = readPageClick({ x: 10, y: 20, isEditable: true, selectionText: "" })!;
    const selected = readPageClick({ x: 10, y: 20, isEditable: false, selectionText: "hello" })!;

    assert.deepEqual(lines(contextMenuTemplate(pageClickInfo(field, false), { ...noSpelling, openSettings: () => undefined })), [
        ["Cut Ctrl+X (off)", "Copy Ctrl+C (off)", "Paste Ctrl+V (off)"],
        ["Select All Ctrl+A"],
        ["GUI Settings… Ctrl+,"],
    ]);
    assert.deepEqual(lines(contextMenuTemplate(pageClickInfo(field, true), noSpelling))[0], ["Cut Ctrl+X (off)", "Copy Ctrl+C (off)", "Paste Ctrl+V"]);
    assert.deepEqual(lines(contextMenuTemplate(pageClickInfo(selected, true), noSpelling)), [["Copy Ctrl+C"]]);
});

test("a page's report opens the menu only when Electron's event did not come for the same click", () => {
    assert.equal(eventCovered(undefined, 1000), false);
    assert.equal(eventCovered(990, 1000), true);
    assert.equal(eventCovered(1100, 1000), true);
    assert.equal(eventCovered(500, 1000), false);
});

test("the preload reports only a right-click the page left alone (Pi Pocket's session menu keeps its own)", () => {
    const preload = readFileSync(join(__dirname, "..", "..", "src", "preload", "server.ts"), "utf8");
    const report = preload.slice(preload.indexOf("function reportRightClicks"));

    assert.match(report, /addEventListener\("contextmenu", \(event\) => \{\n\s+if \(event\.defaultPrevented\) \{\n\s+return;/);
    // Bubbling, not capturing: the page's own handlers run first and can claim the click.
    assert.doesNotMatch(report.slice(0, report.indexOf("}\n")), /, true\)/);
});

test("the menu opens at the pointer and flips back inside the window", () => {
    const size = { width: 200, height: 80 };
    const viewport = { width: 800, height: 600 };

    assert.deepEqual(placeMenu({ x: 40, y: 50 }, size, viewport), { left: 40, top: 50 });
    assert.deepEqual(placeMenu({ x: 700, y: 560 }, size, viewport), { left: 500, top: 480 });
    assert.deepEqual(placeMenu({ x: 4, y: 4 }, size, { width: 100, height: 40 }), { left: 8, top: 8 });
});

test("the session menu's keys", () => {
    assert.equal(menuKey("ArrowDown", false), "down");
    assert.equal(menuKey("Tab", true), "previous");
    assert.equal(menuKey("Enter", false), "activate");
    assert.equal(menuKey("Escape", false), "close");
    assert.equal(menuKey("a", false), undefined);
    assert.equal(menuStep(3, -1, "down"), 0);
    assert.equal(menuStep(3, -1, "up"), 2);
    assert.equal(menuStep(3, 0, "up"), 2);
    assert.equal(menuStep(3, 2, "next"), 0);
    assert.equal(menuStep(3, 1, "home"), 0);
    assert.equal(menuStep(3, 0, "end"), 2);
    assert.equal(menuStep(3, 1, "activate"), undefined);
    assert.equal(menuStep(0, -1, "down"), undefined);
});

test("every color is the page's variable or the app's last theme; no fixed color", () => {
    const sheet = menuSheet(DEFAULT_THEME);

    assert.match(sheet, /background: var\(--panel, #1a1b26\)/);
    assert.match(sheet, /color: var\(--text, #c0caf5\)/);
    assert.match(sheet, /var\(--hover, color-mix\(in srgb, #a9b1d6 7%, transparent\)\)/);
    assert.match(sheet, /var\(--faint, /);
    assert.match(sheet, /var\(--hair, /);

    const light = menuSheet({ mode: "light", colors: { ...DEFAULT_THEME.colors, bg: "#fafafa", text: "#111111" } });

    assert.match(light, /var\(--panel, #fafafa\)/);
    // Hex colors in the sheet are only the theme's own.
    const themeHexes = new Set(Object.values(DEFAULT_THEME.colors));

    for (const hex of sheet.match(/#[0-9a-f]{3,8}\b/gi) ?? []) {
        assert.ok(themeHexes.has(hex), hex);
    }

    assert.doesNotMatch(sheet, /rgb\(|hsl\(|\bblue\b/);
});

/** Just enough DOM to run the real drawMenu: elements with children, attributes, events, and focus. */
function fakePage() {
    type Listener = (event: FakeEvent) => void;
    interface FakeEvent {
        type: string;
        key?: string;
        shiftKey?: boolean;
        isComposing?: boolean;
        timeStamp: number;
        path: FakeElement[];
        current?: FakeElement;
        stopped?: boolean;
        defaultPrevented: boolean;
        preventDefault(): void;
        stopPropagation(): void;
        composedPath(): FakeElement[];
    }

    let focused: FakeElement | undefined;
    const windowListeners = new Map<string, Set<Listener>>();
    const documentListeners = new Map<string, Set<Listener>>();

    class FakeElement {
        children: FakeElement[] = [];
        parent: FakeElement | undefined;
        attributes = new Map<string, string>();
        listeners = new Map<string, Listener[]>();
        style: Record<string, string> = {};
        className = "";
        textContent = "";
        type = "";
        tabIndex = 0;
        adoptedStyleSheets: unknown[] = [];

        constructor(public tag: string) {}

        get isConnected(): boolean {
            let node: FakeElement | undefined = this;

            while (node.parent !== undefined) {
                node = node.parent;
            }

            return node === root;
        }

        get offsetWidth(): number {
            return 220;
        }

        get offsetHeight(): number {
            return 30 * this.querySelectorAll(".item").length;
        }

        get activeElement(): FakeElement | undefined {
            return focused;
        }

        attachShadow(): FakeElement {
            const shadow = new FakeElement("#shadow");

            shadow.parent = this;
            this.children.push(shadow);

            return shadow;
        }

        append(...nodes: FakeElement[]): void {
            for (const node of nodes) {
                node.parent = this;
                this.children.push(node);
            }
        }

        remove(): void {
            if (this.parent !== undefined) {
                this.parent.children = this.parent.children.filter((child) => child !== this);
                this.parent = undefined;
            }
        }

        setAttribute(name: string, value: string): void {
            this.attributes.set(name, value);
        }

        addEventListener(type: string, listener: Listener): void {
            this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
        }

        focus(): void {
            focused = this;
        }

        click(): void {
            dispatch(this, event("click"));
        }

        all(): FakeElement[] {
            return this.children.flatMap((child) => [child, ...child.all()]);
        }

        querySelectorAll(selector: string): FakeElement[] {
            return this.all().filter((each) => each.className === "item" && (selector === ".item" || each.attributes.get("aria-disabled") !== "true"));
        }
    }

    const root = new FakeElement("html");
    const body = new FakeElement("body");
    const field = new FakeElement("textarea");

    root.append(body);
    body.append(field);
    field.focus();

    const event = (type: string, extra: Partial<FakeEvent> = {}): FakeEvent => ({
        type,
        timeStamp: 1000,
        path: [],
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
        // As in a browser: a listener outside the closed shadow root does not see the nodes inside it.
        composedPath() {
            const inside = (node: FakeElement | undefined): boolean => {
                for (let each = node; each !== undefined; each = each.parent) {
                    if (each.tag === "#shadow") {
                        return true;
                    }
                }

                return false;
            };

            return inside(this.current) ? this.path : this.path.filter((node) => !inside(node));
        },
        ...extra,
    });

    function dispatch(target: FakeElement, each: FakeEvent): FakeEvent {
        const path: FakeElement[] = [];

        for (let node: FakeElement | undefined = target; node !== undefined; node = node.parent) {
            path.push(node);
        }

        each.path = path;

        for (const node of path) {
            each.current = node;

            for (const listener of node.listeners.get(each.type) ?? []) {
                listener(each);
            }

            if (each.stopped === true) {
                break;
            }
        }

        return each;
    }

    const globals = {
        document: {
            get activeElement() {
                return focused;
            },
            documentElement: root,
            hidden: false,
            createElement: (tag: string) => new FakeElement(tag),
            addEventListener: (type: string, listener: Listener) => documentListeners.set(type, new Set([...(documentListeners.get(type) ?? []), listener])),
            removeEventListener: (type: string, listener: Listener) => documentListeners.get(type)?.delete(listener),
        },
        addEventListener: (type: string, listener: Listener) => windowListeners.set(type, new Set([...(windowListeners.get(type) ?? []), listener])),
        removeEventListener: (type: string, listener: Listener) => windowListeners.get(type)?.delete(listener),
        innerWidth: 800,
        innerHeight: 600,
        performance: { now: () => 0 },
        HTMLElement: FakeElement,
        CSSStyleSheet: class {
            replaceSync() {}
        },
    };

    const menus = () => root.all().filter((each) => each.attributes.get("role") === "menu");
    // One global for every script, as the menu's isolated world keeps one for the page's life.
    const context: Record<string, unknown> = { ...globals };

    context.globalThis = context;

    return {
        context,
        field,
        menus,
        buttons: () => menus()[0]?.all().filter((each) => each.className === "item") ?? [],
        dispatch,
        event,
        fire: (where: "window" | "document", type: string, extra: Partial<FakeEvent> = {}) => {
            for (const listener of (where === "window" ? windowListeners : documentListeners).get(type) ?? []) {
                listener(event(type, extra));
            }
        },
        focused: () => focused,
        host: () => root.children.find((each) => each.tag === "pi-pocket-gui-menu"),
    };
}

/** Runs the exact source the main process sends, in a context with `page`'s DOM. The menu is drawn on return. */
function draw(page: ReturnType<typeof fakePage>, template: MenuItemConstructorOptions[], key: number): Promise<number | null> {
    const context = page.context;
    const input = { groups: themedGroups(template, false), x: 700, y: 560, label: "Pi Pocket", sheet: menuSheet(DEFAULT_THEME) };

    assert.equal(runInNewContext(menuScript(key, input), context), true);

    return runInNewContext(pickScript(key), context) as Promise<number | null>;
}

test("the drawn menu: keys move over the enabled lines, Enter picks, and the focus goes back to the field", async () => {
    const page = fakePage();
    const template = contextMenuTemplate(click({ isEditable: true, editFlags: { ...flags, canCut: false } }), { ...noSpelling, openSettings: () => undefined });
    const picked = draw(page, template, 1);

    assert.equal(page.menus().length, 1);
    assert.deepEqual(
        page.buttons().map((button) => button.children.map((span) => span.textContent).join(" ")),
        ["Cut Ctrl+X", "Copy Ctrl+C", "Paste Ctrl+V", "Select All Ctrl+A", "GUI Settings… Ctrl+,"],
    );
    assert.equal(page.buttons()[0]!.attributes.get("aria-disabled"), "true");
    // Kept inside the window: flipped to the pointer's left and above it.
    assert.deepEqual(page.menus()[0]!.style, { left: "480px", top: "410px" });

    const menu = page.menus()[0]!;
    const press = (key: string) => page.dispatch(menu, page.event("keydown", { key }));

    press("ArrowDown");
    assert.equal(page.focused(), page.buttons()[1]);
    press("ArrowUp");
    assert.equal(page.focused(), page.buttons()[4]);
    press("Home");
    press("ArrowDown");
    assert.equal(page.focused(), page.buttons()[2]);
    press("Enter");

    assert.equal(await picked, template.findIndex((item) => item.role === "paste"));
    assert.equal(page.host(), undefined);
    assert.equal(page.focused(), page.field);
});

test("the drawn menu closes without a pick on Escape, outside press, blur, scroll, or resize", async () => {
    const template = contextMenuTemplate(click({ selectionText: "hi" }), { ...noSpelling, openSettings: () => undefined });
    const ways: [string, (page: ReturnType<typeof fakePage>) => void][] = [
        ["escape", (page) => page.dispatch(page.menus()[0]!, page.event("keydown", { key: "Escape" }))],
        ["outside press", (page) => page.dispatch(page.host()!, page.event("mousedown", { timeStamp: 5000 }))],
        ["blur", (page) => page.fire("window", "blur")],
        ["resize", (page) => page.fire("window", "resize")],
        ["scroll", (page) => page.fire("document", "scroll")],
    ];

    for (const [name, close] of ways) {
        const page = fakePage();
        const picked = draw(page, template, 2);

        close(page);
        assert.equal(await picked, null, name);
        assert.equal(page.host(), undefined, name);
    }
});

test("a mouse press on a line keeps the menu open for its click; a press beside the menu closes it", async () => {
    const template = contextMenuTemplate(click({ selectionText: "hi" }), { ...noSpelling, openSettings: () => undefined });
    const page = fakePage();
    const picked = draw(page, template, 5);
    const line = page.buttons()[0]!;
    const press = page.dispatch(line, page.event("mousedown", { timeStamp: 5000 }));

    assert.equal(press.defaultPrevented, true);
    assert.equal(page.menus().length, 1);
    // A right-click on the menu opens nothing else and leaves it open.
    assert.equal(page.dispatch(line, page.event("contextmenu", { timeStamp: 5000 })).defaultPrevented, true);
    assert.equal(page.menus().length, 1);
    line.click();
    assert.equal(await picked, template.findIndex((item) => item.role === "copy"));

    const other = fakePage();
    const none = draw(other, template, 6);

    other.dispatch(other.host()!, other.event("mousedown", { timeStamp: 5000 }));
    assert.equal(await none, null);
});

test("a disabled line does nothing; a second right-click replaces the open menu", async () => {
    const page = fakePage();
    const template = contextMenuTemplate(click({}), { ...noSpelling, openSettings: () => undefined });
    const first = draw(page, template, 3);

    page.buttons()[0]!.click();
    assert.equal(page.menus().length, 1);

    const second = draw(page, template, 4);

    assert.equal(await first, null);
    assert.equal(page.menus().length, 1);
    page.buttons()[1]!.click();
    assert.equal(await second, template.findIndex((item) => item.label === "GUI Settings…"));
});
