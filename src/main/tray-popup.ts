/**
 * The tray menu on Windows: a frameless popup, because a native Win32 menu cannot be restyled. It opens at the tray
 * icon, stays on screen, and closes on blur, Escape, or a click outside it. Keyboard: Up, Down, Home, End, Enter,
 * Escape. Other desktops keep Electron's native menu (src/main/desktop.ts).
 */
import { join } from "node:path";
import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type Rectangle, type Tray } from "electron";
import type { ThemeColors } from "../shared/types";
import { placeTrayMenu, trayMenuPalette, type TrayMenuModel, type TrayMenuPalette, type TrayMenuRow, type TrayMenuStyle } from "./tray-menu";

/** What the popup needs, and nothing of the rest of the app. */
export interface TrayPopupHost {
    /** The tray icon, for where it sits. */
    tray: () => Tray | undefined;
    /** The menu's items, rebuilt each time it opens. */
    menu: () => TrayMenuModel;
    style: () => TrayMenuStyle;
    /** Whether Windows' apps are in dark mode. */
    windowsDark: () => boolean;
    theme: () => ThemeColors;
    /** Windows' accent, #rrggbb, for the keyboard focus only. */
    accent: () => string;
    /** Run one item, then the popup closes. */
    activate: (id: string) => void;
    /** Return focus to the notification area (Windows). */
    focusTray: () => void;
}

const GAP = 4;
const MARGIN = 8;
/** A Windows tray menu is narrow: labels truncate rather than the menu growing across the screen. */
const WIDTH = 264;
/** The page is measured after it loads; this only sizes the window for that moment. */
const MAX_HEIGHT = 640;

export function setUpTrayPopup(host: TrayPopupHost): {
    /** Open the menu at the tray icon. A second call closes it. */
    toggle: () => void;
    /** The menu's items changed while it is open: draw them again. */
    refresh: () => void;
    close: () => void;
    /** Whether the popup is open. The tray's click should not also hide the window then. */
    isOpen: () => boolean;
} {
    let popup: BrowserWindow | undefined;
    let open = false;
    /** The window has been shown, so a blur now is the person leaving it. Blur before that is the load, not a close. */
    let shown = false;
    let listening = false;
    /** Which load is current. A newer open supersedes one still loading, so the old one must not place the window. */
    let load = 0;

    const close = (): void => {
        open = false;
        shown = false;
        popup?.hide();
    };

    const onChoose = (event: IpcMainEvent, id: unknown): void => {
        if (popup === undefined || event.sender !== popup.webContents || typeof id !== "string") {
            return;
        }

        close();
        host.activate(id);
    };

    const show = (): void => {
        const window = windowOf();
        const menu = host.menu();
        const palette = trayMenuPalette(host.style(), host.windowsDark(), host.theme(), host.accent());

        open = true;
        load += 1;
        paint(window, menu.rows, palette, load);
    };

    /** The page has loaded: size the window to it, then place it by the tray icon. */
    const place = (painted: number): void => {
        if (!open || painted !== load || popup === undefined || popup.isDestroyed()) {
            return;
        }

        void measure(popup).then((height) => {
            if (!open || popup === undefined || popup.isDestroyed()) {
                return;
            }

            popup.setContentSize(WIDTH, height);

            const icon = host.tray()?.getBounds() ?? cursorRect();
            const at = placeTrayMenu({
                icon,
                menu: { width: WIDTH, height },
                screens: screen.getAllDisplays().map((display) => ({ bounds: display.bounds, workArea: display.workArea })),
                gap: GAP,
                margin: MARGIN,
            });

            popup.setPosition(at.x, at.y);
            popup.show();
            popup.focus();
            shown = true;
        });
    };

    const windowOf = (): BrowserWindow => {
        if (popup !== undefined && !popup.isDestroyed()) {
            return popup;
        }

        popup = new BrowserWindow({
            width: WIDTH,
            height: 120,
            show: false,
            frame: false,
            transparent: true,
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            fullscreenable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: true,
            roundedCorners: true,
            backgroundColor: "#00000000",
            webPreferences: {
                preload: join(__dirname, "..", "preload", "tray-menu.js"),
                contextIsolation: true,
                sandbox: true,
                nodeIntegration: false,
            },
        });
        popup.setAlwaysOnTop(true, "pop-up-menu");
        popup.setVisibleOnAllWorkspaces(true);
        popup.on("blur", () => {
            if (shown) {
                close();
            }
        });

        if (!listening) {
            listening = true;
            ipcMain.on("tray-menu:choose", onChoose);
        }

        const contents = popup.webContents;

        contents.on("before-input-event", (event, input) => {
            if (input.type === "keyDown" && input.key === "Escape") {
                event.preventDefault();
                close();
                host.focusTray();
            }
        });
        contents.setWindowOpenHandler(() => ({ action: "deny" }));
        contents.on("will-navigate", (event) => event.preventDefault());
        contents.on("did-finish-load", () => {
            const painted = loadOf(contents.getURL());

            if (painted !== undefined) {
                place(painted);
            }
        });

        return popup;
    };

    return {
        toggle: () => {
            if (open) {
                close();
                host.focusTray();
                return;
            }

            show();
        },
        refresh: () => {
            if (!open || popup === undefined || popup.isDestroyed()) {
                return;
            }

            show();
        },
        close,
        isOpen: () => open,
    };
}

/** The page's own height, capped, so the window matches what it drew. */
async function measure(window: BrowserWindow): Promise<number> {
    const height = await window.webContents
        .executeJavaScript("document.querySelector('.menu')?.offsetHeight ?? 0")
        .catch(() => 0);

    return Math.min(typeof height === "number" && height > 0 ? height : 120, MAX_HEIGHT);
}

function cursorRect(): Rectangle {
    const point = screen.getCursorScreenPoint();

    return { x: point.x, y: point.y, width: 0, height: 0 };
}

function paint(window: BrowserWindow, rows: TrayMenuRow[], palette: TrayMenuPalette, painted: number): void {
    const page = menuPage(rows, palette);

    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}#${painted}`);
}

/** The load a page belongs to, from the marker paint() appended. */
function loadOf(url: string): number | undefined {
    const marker = Number(url.slice(url.lastIndexOf("#") + 1));

    return Number.isInteger(marker) ? marker : undefined;
}

/** The menu page. Every value is escaped: labels come from the server's page. */
export function menuPage(rows: TrayMenuRow[], palette: TrayMenuPalette, hoverId?: string): string {
    const items = rows
        .map((row, index) => {
            if (row.kind === "separator") {
                return `<div class="sep" role="separator"></div>`;
            }

            if (row.kind === "header") {
                return `<div class="header" role="presentation">${escapeHtml(row.label)}</div>`;
            }

            const mark = row.mark === undefined ? "" : `<span class="mark">${escapeHtml(row.mark)}</span>`;

            const hovered = row.id === hoverId ? " hover" : "";

            return `<button class="item${hovered}" type="button" data-id="${escapeHtml(row.id)}" role="menuitem" tabindex="${index === 0 ? "0" : "-1"}">${mark}<span class="label">${escapeHtml(row.label)}</span></button>`;
        })
        .join("");

    return `<!doctype html>
<html data-style="${palette.style}" data-mode="${palette.mode}">
<head>
<meta charset="utf-8" />
<style>
  :root {
    color-scheme: ${palette.mode};
    --menu: ${palette.menu};
    --text: ${palette.text};
    --muted: ${palette.muted};
    --hover: ${palette.hover};
    --hair: ${palette.hair};
    --accent: ${palette.accent};
    --radius: ${palette.radius}px;
    --font: ${palette.font};
  }
  html, body { margin: 0; background: transparent; }
  body { font: 14px/1.2 var(--font); }
  .menu {
    box-sizing: border-box;
    margin: 0;
    padding: 4px;
    background: var(--menu);
    color: var(--text);
    border: 1px solid var(--hair);
    border-radius: var(--radius);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
  }
  html[data-style="theme"] .menu { box-shadow: 0 24px 60px -16px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--hair); }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 14px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    cursor: default;
  }
  html[data-style="theme"] .item { height: 32px; padding: 0 10px; border-radius: 6px; font-size: 13px; }
  .item:hover, .item:focus, .item.hover { background: var(--hover); outline: none; }
  .item:focus-visible { background: var(--hover); box-shadow: inset 0 0 0 1px var(--accent); }
  .mark { width: 16px; flex: none; text-align: center; color: var(--muted); }
  .label { overflow: hidden; text-overflow: ellipsis; }
  .header {
    height: 28px;
    padding: 8px 12px 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 20px;
  }
  html[data-style="theme"] .header { height: 24px; padding: 6px 10px 0; font-size: 11px; }
  .sep { height: 1px; margin: 4px 8px; background: var(--hair); }
</style>
</head>
<body>
<div class="menu" role="menu">${items}</div>
<script>
  const items = [...document.querySelectorAll(".item")];
  let current = 0;
  const focusAt = (index) => {
    if (items.length === 0) return;
    current = (index + items.length) % items.length;
    items[current].focus();
  };
  for (const item of items) {
    item.addEventListener("click", () => window.trayMenu.choose(item.dataset.id));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); focusAt(current + 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); focusAt(current - 1); }
    else if (event.key === "Home") { event.preventDefault(); focusAt(0); }
    else if (event.key === "End") { event.preventDefault(); focusAt(items.length - 1); }
    else if (event.key === "Enter" && items[current]) { event.preventDefault(); window.trayMenu.choose(items[current].dataset.id); }
  });
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char);
}

/** For the screenshot tool: the page of a menu, with nothing of the app around it. */
export function renderTrayMenu(rows: TrayMenuRow[], palette: TrayMenuPalette): string {
    return menuPage(rows, palette);
}

