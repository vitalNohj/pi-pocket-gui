/**
 * The app's side of the host bridge (src/preload/server.ts): what the server's page asks for (the badge, native
 * notifications, the pinned sessions, menu items), and what the app tells it (its window shown or hidden, a session to
 * open, an approval answered in a notification). It also owns the tray's menu and icon, which show the pins and badge.
 *
 * Every call is checked: it must come from the main window's server view, its top frame, on the server's origin.
 */
import { join } from "node:path";
import {
    app,
    ipcMain,
    Menu,
    nativeImage,
    nativeTheme,
    Notification,
    systemPreferences,
    type BaseWindow,
    type IpcMainEvent,
    type IpcMainInvokeEvent,
    type MenuItemConstructorOptions,
    type NativeImage,
    type Tray,
    type WebContents,
} from "electron";
import type { HostEvent, HostHello, HostNotification, PinnedSession, Settings, ThemeColors } from "../shared/types";
import { cornerDot, dotBitmap, paintDot, tint } from "./badge-image";
import { readTheme, rgbOf } from "./theme";
import { pinLabel, readBadge, readNotification, readPinned } from "./bridge-input";
import { offersAllow, showCall } from "./notice-text";
import { buildTrayMenu, readAccent } from "./tray-menu";
import { setUpTrayPopup } from "./tray-popup";

/** What the bridge needs from the rest of the app. */
export interface DesktopHost {
    assets: string;
    window: () => BaseWindow;
    /** The server view's contents: the only page that gets the bridge. */
    contents: () => WebContents;
    /** The configured server's origin. */
    origin: () => string;
    settings: () => Settings;
    /** The server view shows (not the config screen). */
    showingServer: () => boolean;
    /** Show the server view, when it has the server loaded. Whether it shows now. */
    showServer: () => boolean;
    tray: () => Tray | undefined;
    showWindow: () => void;
    toggleWindow: () => void;
    openSettings: () => void;
    quit: () => void;
    /** A tray line for the app's own update, when there is one to take. */
    updateItem: () => { label: string; click: () => void } | undefined;
    /** Pi Pocket's colors now: the tray's π takes the brand color. */
    theme: () => ThemeColors;
    /** The server's page shows other colors. */
    themeChanged: (theme: ThemeColors) => void;
    /** Offline dictation has an engine for this computer. */
    dictation: () => boolean;
    /** A right-click the page left alone, as its preload saw it (src/main/themed-menu.ts reads it). */
    pageRightClick: (click: unknown) => void;
    /** This computer's name, for "Link this computer". */
    computerName: () => string;
    /** Link this computer as a runner to this server, with a one-time code its page made, and run the runner. */
    linkRunner: (server: string, code: string) => Promise<void>;
}

function originOf(url: string): string | undefined {
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}

/** Notifications that show now, by tag: Electron drops a notification's events once nothing holds it. */
const shown = new Map<string, Notification>();
let pins: PinnedSession[] = [];
let badge = 0;
let lastVisible: boolean | undefined;
let trayIcons: { plain: NativeImage; dot: NativeImage; brand: string; dotColor: string } | undefined;

export function setUpDesktop(host: DesktopHost): {
    /** The window was shown, hidden, minimized, restored, or the view changed: tell the page if that changed. */
    visibilityChanged: () => void;
    /** The tray was made, or the desktop's settings changed: draw the tray again. */
    refreshTray: () => void;
    /** The call came from the server's page: its view, its top frame, on the server's origin. */
    fromServerPage: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
    /** The server view left the server, or loaded again: what its page said no longer holds. */
    reset: () => void;
} {
    const fromServerPage = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
        const frame = event.senderFrame;

        return (
            event.sender === host.contents() &&
            frame !== null &&
            frame.parent === null &&
            originOf(frame.url) === host.origin()
        );
    };

    const visible = (): boolean => {
        const window = host.window();

        return window.isVisible() && !window.isMinimized() && host.showingServer();
    };

    const send = (event: HostEvent): void => {
        const contents = host.contents();

        if (!contents.isDestroyed()) {
            contents.send("host:event", event);
        }
    };

    const open = (url: string): void => {
        host.showWindow();

        if (host.showServer()) {
            send({ type: "open", url });
        }
    };

    /** The tray's π, as the rail of Pi Pocket's page draws it, in the theme's brand color; with a dot when sessions need you. */
    const icons = (): { plain: NativeImage; dot: NativeImage } => {
        const colors = host.theme().colors;

        if (trayIcons !== undefined && trayIcons.brand === colors.brand && trayIcons.dotColor === colors.err) {
            return trayIcons;
        }

        // 18 points in macOS's menu bar, 22 in other trays; drawn at twice that for sharp screens.
        const mask = nativeImage.createFromPath(join(host.assets, process.platform === "darwin" ? "tray-pi-36.png" : "tray-pi-44.png"));
        const { width, height } = mask.getSize();
        const pixels = Buffer.from(mask.toBitmap());

        tint(pixels, rgbOf(colors.brand));

        const plain = nativeImage.createFromBitmap(Buffer.from(pixels), { width, height, scaleFactor: 2 });

        paintDot(pixels, width, height, cornerDot(width, height), rgbOf(colors.err));

        const dot = nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 2 });

        trayIcons = { plain, dot, brand: colors.brand, dotColor: colors.err };

        return trayIcons;
    };

    // The tray is created after this runs (createTray), so the clicks are attached on the first refresh, once.
    let clicksAttached = false;

    const attachClicks = (tray: Tray): void => {
        if (clicksAttached || process.platform !== "win32") {
            return;
        }

        clicksAttached = true;
        // The left-click handler lives in createTray and shows or hides the window. A right-click opens the menu, and
        // the next left-click closes it first, so the window does not also move.
        tray.on("right-click", () => popup?.toggle());
        tray.on("click", () => {
            if (popup?.isOpen() === true) {
                popup.close();
            }
        });
    };

    const refreshTray = (): void => {
        const tray = host.tray();

        if (tray === undefined || tray.isDestroyed()) {
            return;
        }

        attachClicks(tray);

        const pinItems: MenuItemConstructorOptions[] = pins.map((pin) => ({
            label: pinLabel(pin),
            toolTip: pin.label,
            click: () => open(pin.url),
        }));
        const update = host.updateItem();
        const template: MenuItemConstructorOptions[] = [
            { label: badge > 0 ? `Open Pi Pocket  (${badge} need you)` : "Open Pi Pocket", click: host.showWindow },
            ...(update === undefined ? [] : [{ label: update.label, click: update.click }]),
            ...(pinItems.length > 0
                ? [{ type: "separator" as const }, { label: "Pinned", enabled: false }, ...pinItems]
                : []),
            { type: "separator" },
            { label: "Server settings…", click: host.openSettings },
            { type: "separator" },
            { label: "Quit", click: host.quit },
        ];

        if (process.platform === "win32") {
            // A native Win32 menu cannot be restyled, so Windows gets the popup. It opens on click and on right-click.
            tray.setContextMenu(null);
        } else {
            tray.setContextMenu(Menu.buildFromTemplate(template));
        }

        tray.setImage(badge > 0 ? icons().dot : icons().plain);
        tray.setToolTip(badge > 0 ? `Pi Pocket — ${badge} ${badge === 1 ? "session needs" : "sessions need"} you` : "Pi Pocket");
        popup?.refresh();
    };

    const menuModel = () =>
        buildTrayMenu({
            badge,
            update: host.updateItem(),
            pins,
            showWindow: host.showWindow,
            openSettings: host.openSettings,
            quit: host.quit,
            openPin: open,
        });

    // Windows only. macOS and Linux keep the native menu above, and the trayMenu setting is ignored there.
    const popup =
        process.platform === "win32"
            ? setUpTrayPopup({
                  tray: host.tray,
                  menu: menuModel,
                  style: () => host.settings().appearance.trayMenu,
                  windowsDark: () => nativeTheme.shouldUseDarkColors,
                  theme: host.theme,
                  accent: () => readAccent(systemPreferences.getAccentColor()),
                  activate: (id) => menuModel().actions.find((action) => action.id === id)?.run(),
                  focusTray: () => host.tray()?.focus(),
              })
            : undefined;

    const setBadge = (count: number): void => {
        badge = count;
        // macOS's dock, and Unity launchers on Linux. Windows has no count: an overlay dot instead.
        app.setBadgeCount(count);

        if (process.platform === "win32") {
            const window = host.window() as BaseWindow & {
                setOverlayIcon?: (overlay: NativeImage | null, description: string) => void;
            };
            const size = 16;

            window.setOverlayIcon?.(
                count > 0 ? nativeImage.createFromBitmap(dotBitmap(size), { width: size, height: size }) : null,
                count > 0 ? `${count} need you` : "",
            );
        }

        refreshTray();
    };

    const notify = (message: HostNotification): void => {
        const settings = host.settings().notifications;

        if (!settings.enabled || !Notification.isSupported()) {
            return;
        }

        const approval = message.approval;
        const call = approval === undefined ? undefined : showCall(approval.call, settings.maxCallLength);
        const allow = approval !== undefined && call !== undefined && offersAllow(settings.allowFromNotification, approval.may, call);
        // Allow comes first where it is offered; Deny is always there for an approval.
        const actions = approval === undefined ? [] : allow ? ["Allow", "Deny"] : ["Deny"];
        const notification = new Notification({
            title: message.title,
            body: call !== undefined ? call.text : message.body,
            silent: !settings.sound,
            icon: join(host.assets, "icon-192.png"),
            urgency: message.urgency === "high" ? "critical" : "normal",
            timeoutType: message.urgency === "high" ? "never" : "default",
            actions: actions.map((text) => ({ type: "button", text })),
            ...(message.tag === "" ? {} : { id: message.tag, groupId: "pi-pocket" }),
        });
        const tag = message.tag === "" ? `untagged-${Date.now()}-${Math.random()}` : message.tag;

        shown.get(tag)?.close();
        shown.set(tag, notification);

        const forget = () => {
            if (shown.get(tag) === notification) {
                shown.delete(tag);
            }
        };

        notification.on("click", () => {
            forget();
            open(message.url);
        });
        notification.on("action", (event) => {
            const chosen = actions[event.actionIndex];

            forget();

            if (approval === undefined || chosen === undefined) {
                return;
            }

            // The page answers with its own sign-in; the server checks again that the person may.
            send({ type: "approve", id: approval.id, allow: chosen === "Allow" });
        });
        notification.on("close", forget);
        notification.on("failed", forget);
        notification.show();
    };

    ipcMain.on("host:hello", (event) => {
        // Only the server view's top frame on the server's origin gets the bridge: never a frame, another window, or a
        // sign-in page in front of the server.
        const hello: HostHello | null = fromServerPage(event)
            ? { visible: visible(), dictation: host.dictation(), computerName: host.computerName() }
            : null;

        event.returnValue = hello;
    });

    // "Link this computer": the code the page just made links this computer to the page's own server, never another.
    ipcMain.handle("host:link-runner", async (event, request: unknown): Promise<{ ok: boolean; error?: string }> => {
        if (!fromServerPage(event)) {
            return { ok: false, error: "Not allowed" };
        }

        const code = typeof request === "object" && request !== null ? (request as { code?: unknown }).code : undefined;

        if (typeof code !== "string" || !/^[A-Za-z0-9-]{4,64}$/.test(code)) {
            return { ok: false, error: "That is not a link code." };
        }

        try {
            await host.linkRunner(host.origin(), code);

            return { ok: true };
        } catch (error) {
            return { ok: false, error: (error as Error).message };
        }
    });

    ipcMain.on("host:invoke", (event, id: unknown) => {
        if (fromServerPage(event) && id === "server-settings") {
            host.openSettings();
        }
    });

    ipcMain.on("host:context-menu", (event, click: unknown) => {
        if (fromServerPage(event)) {
            host.pageRightClick(click);
        }
    });

    ipcMain.on("host:badge", (event, count: unknown) => {
        const value = readBadge(count);

        if (fromServerPage(event) && value !== undefined && value !== badge) {
            setBadge(value);
        }
    });

    ipcMain.on("host:notify", (event, input: unknown) => {
        const message = readNotification(input);

        if (fromServerPage(event) && message !== undefined) {
            notify(message);
        }
    });

    ipcMain.on("host:theme", (event, input: unknown) => {
        const theme = readTheme(input);

        if (fromServerPage(event) && theme !== undefined) {
            host.themeChanged(theme);
            refreshTray();
        }
    });

    ipcMain.on("host:pinned", (event, input: unknown) => {
        if (fromServerPage(event)) {
            pins = readPinned(input);
            refreshTray();
        }
    });

    return {
        visibilityChanged: () => {
            const now = visible();

            if (now !== lastVisible) {
                lastVisible = now;
                send({ type: "visibility", visible: now });
            }
        },
        refreshTray,
        fromServerPage,
        reset: () => {
            pins = [];

            if (badge !== 0) {
                setBadge(0);
            } else {
                refreshTray();
            }

            lastVisible = undefined;
        },
    };
}
