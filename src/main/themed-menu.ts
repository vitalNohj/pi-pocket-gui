/// <reference lib="dom" />
/**
 * The right-click menu's look. What it offers stays `contextMenuTemplate`'s (src/main/context-menu.ts): this module
 * only draws that template inside the page, styled like Pi Pocket's own session menu and in the page's live colors,
 * and runs the item the person picks. Where it cannot be drawn, the caller pops the template up as a native menu.
 *
 * The menu is drawn by `drawMenu`, run in an isolated world of its own (not the page's, not the preload's), in a
 * closed shadow root: the page's scripts cannot see or click it, and the page's CSS cannot reach into it. The colors
 * are the page's CSS variables, which inherit into the shadow root, so a theme change restyles an open menu too.
 */
import type { MenuItemConstructorOptions } from "electron";
import type { ThemeColors } from "../shared/types";
import type { ClickInfo } from "./context-menu";

/** The isolated world the menu runs in. Any id other than 0 (the page) and the preload's own. */
export const MENU_WORLD = 1717;

/** One line of the drawn menu. `id` is the item's index in the template, which is what runs when it is picked. */
export interface ThemedItem {
    id: number;
    label: string;
    /** The quiet text at the line's end: the shortcut. */
    hint?: string;
    enabled: boolean;
}

/** A run of lines; the menu draws a hairline between runs, where the template has a separator. */
export type ThemedGroup = ThemedItem[];

/** The edit roles the template uses: their label, and their key after Ctrl or ⌘. */
const ROLES: Record<string, { label: string; key: string }> = {
    cut: { label: "Cut", key: "X" },
    copy: { label: "Copy", key: "C" },
    paste: { label: "Paste", key: "V" },
    selectAll: { label: "Select All", key: "A" },
};

/** An accelerator as the menu shows it: ⌘, on macOS, Ctrl+, elsewhere. */
export function acceleratorHint(accelerator: string, mac: boolean): string {
    const parts = accelerator.split("+");
    const key = parts.pop() ?? "";
    const names: Record<string, [string, string]> = {
        CommandOrControl: ["⌘", "Ctrl"],
        CmdOrCtrl: ["⌘", "Ctrl"],
        Command: ["⌘", "Cmd"],
        Cmd: ["⌘", "Cmd"],
        Control: ["⌃", "Ctrl"],
        Ctrl: ["⌃", "Ctrl"],
        Alt: ["⌥", "Alt"],
        Option: ["⌥", "Alt"],
        Shift: ["⇧", "Shift"],
    };
    const modifiers = parts.map((part) => names[part]?.[mac ? 0 : 1] ?? part);

    return mac ? [...modifiers, key].join("") : [...modifiers, key].join("+");
}

/** The template as the drawn menu's groups. Every item keeps its index, so the pick runs the template's own item. */
export function themedGroups(template: readonly MenuItemConstructorOptions[], mac: boolean): ThemedGroup[] {
    const groups: ThemedGroup[] = [[]];

    template.forEach((item, id) => {
        if (item.type === "separator") {
            groups.push([]);

            return;
        }

        const role = item.role === undefined ? undefined : ROLES[item.role];
        const label = item.label ?? role?.label;

        if (label === undefined) {
            return;
        }

        const hint = item.accelerator !== undefined
            ? acceleratorHint(String(item.accelerator), mac)
            : role !== undefined
              ? acceleratorHint(`CommandOrControl+${role.key}`, mac)
              : undefined;

        groups.at(-1)!.push({ id, label, ...(hint === undefined ? {} : { hint }), enabled: item.enabled !== false });
    });

    return groups.filter((group) => group.length > 0);
}

/** The editing a role item stands for: the same web contents commands the native menu's roles run. */
export interface EditCommands {
    cut(): void;
    copy(): void;
    paste(): void;
    selectAll(): void;
}

/**
 * Runs what the drawn menu picked: `id` is the template index `drawMenu` resolved with. Anything else (nothing
 * picked, a separator, a disabled item, an id that is not in the template) does nothing.
 */
export function runPicked(template: readonly MenuItemConstructorOptions[], id: unknown, edit: EditCommands): void {
    const item = typeof id === "number" && Number.isInteger(id) ? template[id] : undefined;

    if (item === undefined || item.type === "separator" || item.enabled === false) {
        return;
    }

    switch (item.role) {
        case "cut":
            edit.cut();
            break;
        case "copy":
            edit.copy();
            break;
        case "paste":
            edit.paste();
            break;
        case "selectAll":
            edit.selectAll();
            break;
        case undefined:
            (item.click as (() => void) | undefined)?.();
            break;
    }
}

/**
 * The page's own right-click, as the server page's preload reports it (src/preload/server.ts). On macOS a
 * WebContentsView's `context-menu` event has been known not to fire; this is what the menu opens from then.
 */
export interface PageClick {
    x: number;
    y: number;
    isEditable: boolean;
    selectionText: string;
}

/** A page click from the preload, checked: the page could send anything. */
export function readPageClick(input: unknown): PageClick | undefined {
    if (typeof input !== "object" || input === null) {
        return undefined;
    }

    const { x, y, isEditable, selectionText } = input as Record<string, unknown>;

    if (!Number.isFinite(x) || !Number.isFinite(y) || typeof isEditable !== "boolean" || typeof selectionText !== "string") {
        return undefined;
    }

    return { x: x as number, y: y as number, isEditable, selectionText: selectionText.slice(0, 10_000) };
}

/**
 * What the template needs, from the page's click alone. The page knows no spelling, so there are no suggestions here;
 * the edit commands are enabled the way Chromium enables them.
 */
export function pageClickInfo(click: PageClick, clipboardHasContent: boolean): ClickInfo {
    const selected = click.selectionText !== "";

    return {
        misspelledWord: "",
        dictionarySuggestions: [],
        isEditable: click.isEditable,
        selectionText: click.selectionText,
        editFlags: {
            canUndo: false,
            canRedo: false,
            canCut: click.isEditable && selected,
            canCopy: selected,
            canPaste: click.isEditable && clipboardHasContent,
            canDelete: click.isEditable && selected,
            canSelectAll: click.isEditable,
            canEditRichly: false,
        },
    };
}

/**
 * The page's report and Electron's `context-menu` event can both come for one right-click (where the event fires,
 * which is everywhere but where macOS drops it). The event knows the spelling, so it wins: the page's report opens
 * the menu only when no event came within `window` ms around it.
 */
export function eventCovered(lastEventAt: number | undefined, pageClickAt: number, window = PAGE_CLICK_WAIT_MS): boolean {
    return lastEventAt !== undefined && lastEventAt >= pageClickAt - window;
}

/** How long a page's report waits for Electron's event before it opens the menu itself. */
export const PAGE_CLICK_WAIT_MS = 200;

/** The menu's sheet. Each color is one of the page's own variables (Pi Pocket's names), else the app's last theme. */
export function menuSheet(theme: ThemeColors): string {
    const { bg, body, desk, text } = theme.colors;
    const hover = `color-mix(in srgb, ${body} 7%, transparent)`;
    const hair = `color-mix(in srgb, ${body} 10%, transparent)`;
    const faint = `color-mix(in oklab, ${body} 42%, ${bg})`;

    // Pi Pocket's .pop-overlay, .pop-menu, .session-menu, .session-menu-group, .session-menu-item, and
    // .session-menu-hint (web/style.css there).
    return `
.menu {
    position: fixed;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: max-content;
    min-width: 200px;
    max-width: min(300px, calc(100vw - 16px));
    max-height: calc(100dvh - 16px);
    overflow-x: hidden;
    overflow-y: auto;
    padding: 4px;
    background: var(--panel, ${bg});
    color: var(--text, ${text});
    border-radius: var(--r-card, 8px);
    box-shadow: var(--pop, 0 24px 60px -16px color-mix(in srgb, ${desk} 60%, transparent), 0 0 0 1px ${hair});
    font: 14px / 1.55 var(--sans, "Pocket Sans", "Geist", ui-sans-serif, system-ui, sans-serif);
    outline: none;
    animation: pop 0.15s var(--ease-out, cubic-bezier(0.23, 1, 0.32, 1));
    -webkit-user-select: none;
    user-select: none;
}
.group + .group {
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--hair, ${hair});
}
.item {
    display: flex;
    align-items: baseline;
    gap: 16px;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 6px 10px;
    border: 0;
    border-radius: var(--r-row, 6px);
    background: none;
    color: var(--text, ${text});
    font: inherit;
    font-size: 13px;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
}
.item[aria-disabled="true"] {
    color: var(--faint, ${faint});
    cursor: default;
}
.item:focus-visible {
    outline: none;
    background: var(--hover, ${hover});
}
@media (hover: hover) {
    .item:hover:not([aria-disabled="true"]) {
        background: var(--hover, ${hover});
    }
}
.hint {
    margin-left: auto;
    color: var(--faint, ${faint});
    font-size: 11.5px;
}
@keyframes pop {
    from {
        opacity: 0;
        transform: translateY(6px) scale(0.98);
    }
}
@media (prefers-reduced-motion: reduce) {
    .menu {
        animation: none;
    }
}
`;
}

/** Where the menu sits: at the pointer, flipped back inside the window, with the 8px margin the session menu keeps. */
export function placeMenu(
    at: { x: number; y: number },
    size: { width: number; height: number },
    viewport: { width: number; height: number },
): { left: number; top: number } {
    return {
        left: at.x + size.width + 8 > viewport.width ? Math.max(8, at.x - size.width) : at.x,
        top: at.y + size.height + 8 > viewport.height ? Math.max(8, at.y - size.height) : at.y,
    };
}

export type MenuKey = "down" | "up" | "home" | "end" | "next" | "previous" | "activate" | "close";

/** The session menu's keys: arrows, Home, End, and Tab move; Enter runs the focused line; Escape closes. */
export function menuKey(key: string, shift: boolean): MenuKey | undefined {
    switch (key) {
        case "ArrowDown":
            return "down";
        case "ArrowUp":
            return "up";
        case "Home":
            return "home";
        case "End":
            return "end";
        case "Tab":
            return shift ? "previous" : "next";
        case "Enter":
            return "activate";
        case "Escape":
            return "close";
        default:
            return undefined;
    }
}

/** The line a key moves to among `count` enabled lines. `from` is -1 while no line has the focus. */
export function menuStep(count: number, from: number, key: MenuKey): number | undefined {
    if (count <= 0 || key === "activate" || key === "close") {
        return undefined;
    }

    if (key === "home") {
        return 0;
    }

    if (key === "end") {
        return count - 1;
    }

    if (from < 0) {
        return key === "up" || key === "previous" ? count - 1 : 0;
    }

    return (from + (key === "up" || key === "previous" ? -1 : 1) + count) % count;
}

/** What `drawMenu` is given. */
export interface DrawInput {
    groups: ThemedGroup[];
    /** The pointer, in the page's CSS pixels. */
    x: number;
    y: number;
    label: string;
    sheet: string;
}

/**
 * Runs in the page (an isolated world): draws the menu at once (a page it cannot be drawn in throws here, and the
 * caller shows the native menu), and returns a promise of the picked line's id, or null when it closes without a pick.
 * Self-contained, since it is sent as source: the helpers come in as arguments.
 */
export function drawMenu(
    input: DrawInput,
    place: typeof placeMenu,
    keyOf: typeof menuKey,
    step: typeof menuStep,
): Promise<number | null> {
    const scope = globalThis as unknown as { __piPocketGuiMenuClose?: () => void };
    let resolve: (id: number | null) => void = () => undefined;
    const picked = new Promise<number | null>((settle) => {
        resolve = settle;
    });

    // One menu at a time: a right-click while one is open replaces it.
    scope.__piPocketGuiMenuClose?.();

    {
        const previous = document.activeElement;
        const host = document.createElement("pi-pocket-gui-menu");
        const shadow = host.attachShadow({ mode: "closed" });

        // Inline, so no rule of the page's can move or hide the layer the menu sits on.
        host.style.cssText = "all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important;";
        const sheet = new CSSStyleSheet();
        const menu = document.createElement("section");
        const opened = performance.now();
        let done = false;

        sheet.replaceSync(input.sheet);
        shadow.adoptedStyleSheets = [sheet];
        menu.className = "menu";
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", input.label);
        menu.tabIndex = -1;

        const finish = (id: number | null): void => {
            if (done) {
                return;
            }

            done = true;
            delete scope.__piPocketGuiMenuClose;
            removeEventListener("blur", close);
            removeEventListener("resize", close);
            removeEventListener("keydown", onWindowKey, true);
            document.removeEventListener("scroll", close, true);
            document.removeEventListener("visibilitychange", onHidden);
            host.remove();

            // The commands act where the focus was: on the field and selection the right-click was on.
            if (previous instanceof HTMLElement && previous.isConnected) {
                previous.focus({ preventScroll: true });
            }

            resolve(id);
        };
        const close = (): void => finish(null);
        const onHidden = (): void => {
            if (document.hidden) {
                close();
            }
        };
        const onWindowKey = (event: KeyboardEvent): void => {
            if (event.key === "Escape" && !event.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                close();
            }
        };

        for (const group of input.groups) {
            const box = document.createElement("div");

            box.className = "group";
            box.setAttribute("role", "group");

            for (const item of group) {
                const button = document.createElement("button");
                const label = document.createElement("span");

                button.type = "button";
                button.className = "item";
                button.setAttribute("role", "menuitem");
                label.textContent = item.label;
                button.append(label);

                if (item.hint !== undefined) {
                    const hint = document.createElement("span");

                    hint.className = "hint";
                    hint.textContent = item.hint;
                    button.append(hint);
                }

                if (item.enabled) {
                    button.addEventListener("click", () => finish(item.id));
                } else {
                    button.setAttribute("aria-disabled", "true");
                    button.tabIndex = -1;
                }

                box.append(button);
            }

            menu.append(box);
        }

        // A press anywhere but the menu closes it, as the session menu's scrim does, without reaching the page.
        host.addEventListener("mousedown", (event) => {
            event.preventDefault();

            if (!event.composedPath().includes(menu) && event.timeStamp - opened > 100) {
                close();
            }
        });
        host.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!event.composedPath().includes(menu)) {
                close();
            }
        });
        menu.addEventListener("keydown", (event) => {
            const key = keyOf(event.key, event.shiftKey);

            if (key === undefined || event.isComposing) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            const lines: HTMLButtonElement[] = Array.prototype.slice.call(menu.querySelectorAll(".item:not([aria-disabled='true'])"));
            const focused = lines.indexOf(shadow.activeElement as HTMLButtonElement);

            if (key === "close") {
                close();
            } else if (key === "activate") {
                lines[focused]?.click();
            } else {
                lines[step(lines.length, focused, key) ?? -1]?.focus();
            }
        });

        shadow.append(menu);
        document.documentElement.append(host);

        const at = place(
            { x: input.x, y: input.y },
            { width: menu.offsetWidth, height: menu.offsetHeight },
            { width: innerWidth, height: innerHeight },
        );

        menu.style.left = `${at.left}px`;
        menu.style.top = `${at.top}px`;
        menu.focus({ preventScroll: true });

        scope.__piPocketGuiMenuClose = close;
        addEventListener("blur", close);
        addEventListener("resize", close);
        addEventListener("keydown", onWindowKey, true);
        document.addEventListener("scroll", close, true);
        document.addEventListener("visibilitychange", onHidden);
    }

    return picked;
}

/**
 * The source that draws menu number `key` in the page: true once it shows. Its pick is waited for separately
 * (`pickScript`), so a page that goes away while the menu is open is not mistaken for one it could not be drawn in.
 */
export function menuScript(key: number, input: DrawInput): string {
    const draw = `(${drawMenu.toString()})(${JSON.stringify(input)}, ${placeMenu.toString()}, ${menuKey.toString()}, ${menuStep.toString()})`;

    return `((globalThis.__piPocketGuiMenus ??= {})[${key}] = ${draw}, true)`;
}

/** The source that waits for menu number `key`'s pick: the line's id, or null. */
export function pickScript(key: number): string {
    return `(async () => { const menus = globalThis.__piPocketGuiMenus ?? {}; try { return (await menus[${key}]) ?? null; } finally { delete menus[${key}]; } })()`;
}
