/**
 * The main process. One window holds two views: the server's page (Pi Pocket itself) and the app's config screen. The
 * server's page stays loaded while the config screen shows, so going back is instant and nothing it was doing stops.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
    app,
    BaseWindow,
    BrowserWindow,
    clipboard,
    dialog,
    globalShortcut,
    ipcMain,
    Menu,
    nativeTheme,
    nativeImage,
    net,
    session,
    shell,
    Tray,
    WebContentsView,
    type ContextMenuParams,
    type IpcMainInvokeEvent,
    type MenuItemConstructorOptions,
    type WebContents,
} from "electron";
import type { BillionContextAction, ConfigReason, ConfigState, DictationAction, LocalAction, ProbeResult, Settings, SettingsProblem, ThemeColors, TitleBarStyle } from "../shared/types";
import { retryDelayMs } from "./backoff";
import { mayConnect, NavigationResponses } from "./connection";
import { CONFIG_URL, isAppPage, registerAppScheme, serveAppPages } from "./config-protocol";
import { contextMenuTemplate, type ClickInfo, type MenuActions } from "./context-menu";
import {
    eventCovered,
    MENU_WORLD,
    menuScript,
    menuSheet,
    PAGE_CLICK_WAIT_MS,
    pageClickInfo,
    pickScript,
    readPageClick,
    runPicked,
    themedGroups,
} from "./themed-menu";
import { setUpAppearance } from "./appearance";
import { parseAppsUseLightTheme, setUpTitleBar, titleBarOptions } from "./titlebar";
import { loadTheme, sameTheme, saveTheme } from "./theme";
import { setUpDesktop } from "./desktop";
import { setUpDictation } from "./dictation";
import { ADAPTER, ADAPTER_PAGE, setUpBillionContext } from "./billion-context";
import { computerName, setUpRunner } from "./runner";
import { setUpLocalServer } from "./local-server";
import { setUpUpdates } from "./updates";
import { setLaunchAtLogin, startedAtLogin, trayAvailable } from "./platform";
import { networkMessage, probe } from "./probe";
import { guardContents, guardSession, openOutside, type OriginPolicy } from "./security";
import { defaultSettings, loadSettings, saveSettings, validateSettings } from "./settings";
import { normalizeServerUrl } from "./url";
import { loadWindowState, saveWindowState } from "./window-state";

const ROOT = join(__dirname, "..", "..");
const ASSETS = join(ROOT, "assets");
const SERVER_PARTITION = "persist:server";
const CONFIG_PARTITION = "gui-config";

const LINKS = {
    github: "https://github.com/TannerMidd/pi-pocket",
    docs: "https://tannermidd.github.io/pi-pocket/docs/",
    releases: "https://github.com/vitalNohj/pi-pocket-gui/releases",
} as const;

// Settings and the server's cookies live in <appData>/pi-pocket-gui, apart from the display name, which may change.
const userData = process.env.PI_POCKET_GUI_USER_DATA;

app.setName("Pi Pocket");
app.setPath(
    "userData",
    userData !== undefined && userData !== "" ? userData : join(app.getPath("appData"), "pi-pocket-gui"),
);
registerAppScheme();

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    void start();
}

/** Everything the app holds while it runs. */
interface Gui {
    window: BaseWindow;
    server: WebContentsView;
    config: WebContentsView;
    tray: Tray | undefined;
    trayAvailable: boolean;
    settings: Settings;
    problems: SettingsProblem[];
    configPath: string;
    showing: "server" | "config";
    reason: ConfigReason;
    probe: ProbeResult | undefined;
    /** The address the server view has loaded, once it did. */
    loadedUrl: string | undefined;
    /** An explicitly opened, unverified HTML page keeps an app-owned way back visible. */
    unverified: boolean;
    connectionAttempt: number;
    /** The next automatic check while the config screen shows a server that does not answer. */
    retry: { timer: NodeJS.Timeout; at: number } | undefined;
    /** Checks that failed in a row: the wait grows with each. */
    retryAttempt: number;
    health: { timer: NodeJS.Timeout; failures: number } | undefined;
    quitting: boolean;
    /** The host bridge's main-process side (src/main/desktop.ts). */
    desktop: ReturnType<typeof setUpDesktop> | undefined;
    /** The app's own updates (src/main/updates.ts). */
    updates: ReturnType<typeof setUpUpdates> | undefined;
    /** The see-through window (src/main/appearance.ts). */
    appearance: ReturnType<typeof setUpAppearance> | undefined;
    /** Linux: the window was made see-through at start; turning that on needs a new window. */
    translucentAtStart: boolean;
    /** The title bar (src/main/titlebar.ts), as the window was made: a change takes a restart. */
    titleBar: ReturnType<typeof setUpTitleBar> | undefined;
    titleBarAtStart: TitleBarStyle;
    /** Pi Pocket's colors, the last its page showed (src/main/theme.ts), and where they are kept. */
    theme: ThemeColors;
    themePath: string;
    /** The notice about a server without the bridge was shown in this run. */
    toldNoBridge: boolean;
    /** Pi Pocket on this computer (src/main/local-server.ts). */
    local: ReturnType<typeof setUpLocalServer> | undefined;
    /** Offline dictation (src/main/dictation.ts). */
    dictation: ReturnType<typeof setUpDictation> | undefined;
    /** billion-context-pi in this computer's Pi Pocket (src/main/billion-context.ts). */
    billionContext: ReturnType<typeof setUpBillionContext> | undefined;
    /** This computer as a runner for a server (src/main/runner.ts). */
    runner: ReturnType<typeof setUpRunner> | undefined;
    /** The login link was opened: the next page drops it from the view's history. */
    signingIn: boolean;
}

let gui: Gui | undefined;

async function start(): Promise<void> {
    await app.whenReady();

    const configPath = join(app.getPath("userData"), "config.json");
    const firstRun = !existsSync(configPath);
    const loaded = loadSettings(configPath);
    const statePath = join(app.getPath("userData"), "window-state.json");
    const placed = loadWindowState(statePath);
    // Linux makes a window see-through only when it is made; macOS and Windows change it at any time.
    const translucentAtStart = process.platform === "linux" && loaded.settings.appearance.translucent;
    const themePath = join(app.getPath("userData"), "theme.json");
    const theme = loadTheme(themePath);
    const solid = theme.colors.bg;
    const titleBarAtStart = loaded.settings.window.titleBar;

    const window = new BaseWindow({
        title: "Pi Pocket",
        width: placed.bounds.width,
        height: placed.bounds.height,
        ...(placed.placed ? { x: placed.bounds.x, y: placed.bounds.y } : {}),
        minWidth: 360,
        minHeight: 480,
        show: false,
        backgroundColor: solid,
        ...(translucentAtStart ? { transparent: true } : {}),
        icon: join(ASSETS, "icon-512.png"),
        autoHideMenuBar: !loaded.settings.window.showMenuBar,
        ...titleBarOptions(process.platform, titleBarAtStart, theme),
    });

    const serverSession = session.fromPartition(SERVER_PARTITION);
    const configSession = session.fromPartition(CONFIG_PARTITION);

    serverSession.setUserAgent(`${serverSession.getUserAgent()} PiPocketGUI/${app.getVersion()}`);
    serveAppPages(configSession, join(ROOT, "dist", "renderer"));
    configSession.setPermissionRequestHandler((_contents, permission, callback) => {
        callback(permission === "clipboard-sanitized-write");
    });

    const server = new WebContentsView({
        webPreferences: {
            session: serverSession,
            // window.pocketHost, the host bridge; the main process decides at its start whether the page gets it.
            preload: join(__dirname, "..", "preload", "server.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            spellcheck: true,
            // Notifications and the live connection keep working while the window is hidden in the tray.
            backgroundThrottling: false,
        },
    });
    const config = new WebContentsView({
        webPreferences: {
            session: configSession,
            preload: join(__dirname, "..", "preload", "config.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
        },
    });

    server.setBackgroundColor(solid);
    config.setBackgroundColor(solid);
    window.contentView.addChildView(server);
    window.contentView.addChildView(config);

    const tray = await trayAvailable();

    gui = {
        window,
        server,
        config,
        tray: undefined,
        trayAvailable: tray,
        settings: loaded.settings,
        problems: loaded.problems,
        configPath,
        showing: "config",
        reason: { kind: "first-run" },
        probe: undefined,
        loadedUrl: undefined,
        unverified: false,
        connectionAttempt: 0,
        retry: undefined,
        retryAttempt: 0,
        health: undefined,
        quitting: false,
        desktop: undefined,
        updates: undefined,
        appearance: undefined,
        translucentAtStart,
        titleBar: undefined,
        titleBarAtStart,
        theme,
        themePath,
        toldNoBridge: false,
        local: undefined,
        dictation: undefined,
        billionContext: undefined,
        runner: undefined,
        signingIn: false,
    };

    gui.titleBar = setUpTitleBar({
        platform: process.platform,
        style: titleBarAtStart,
        window,
        server: server.webContents,
        theme,
        nativeTheme,
        systemScheme: () =>
            new Promise((resolve) => {
                execFile(
                    "reg",
                    ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", "/v", "AppsUseLightTheme"],
                    { windowsHide: true, timeout: 3000 },
                    (_error, stdout) => resolve(parseAppsUseLightTheme(String(stdout))),
                );
            }),
    });

    gui.appearance = setUpAppearance({
        platform: process.platform,
        systemVersion: process.getSystemVersion(),
        window,
        views: [server, config],
        server: server.webContents,
        onServerOrigin: () => originOf(server.webContents.getURL()) === currentOrigin(),
        translucentAtStart,
        solid: () => gui!.theme.colors.bg,
    });

    gui.updates = setUpUpdates({
        assets: ASSETS,
        window: () => window,
        settings: () => gui!.settings,
        changed: () => {
            pushConfigState();
            gui?.desktop?.refreshTray();
        },
        quitting: () => {
            if (gui !== undefined) {
                gui.quitting = true;
            }
        },
    });

    gui.dictation = setUpDictation({
        home: app.getPath("userData"),
        platform: process.platform,
        arch: process.arch,
        settings: () => gui!.settings,
        choose: (model) => {
            const state = gui!;

            state.settings = { ...state.settings, dictation: { ...state.settings.dictation, model } };
            saveSettings(state.configPath, state.settings);
        },
        fetch: (url) => net.fetch(url, { headers: { "user-agent": `pi-pocket-gui/${app.getVersion()}` } }),
        fromServerPage: (event) => gui?.desktop?.fromServerPage(event) === true,
        toPage: (message) => {
            if (!server.webContents.isDestroyed()) {
                server.webContents.send("host:dictation", message);
            }
        },
        changed: () => {
            pushConfigState();
        },
        needModel: () => {
            openSettings();
            gui?.config.webContents.send("config:focus", "dictation");
        },
    });

    gui.local = setUpLocalServer({
        home: join(app.getPath("userData"), "server"),
        platform: process.platform,
        arch: process.arch,
        settings: () => gui!.settings,
        fetch: (url) => net.fetch(url, { headers: { "user-agent": `pi-pocket-gui/${app.getVersion()}` } }),
        probe: (url) =>
            probe(url, (target, init) => serverSession.fetch(target, init), gui!.settings.connection.probeTimeoutMs),
        changed: () => {
            pushConfigState();
            gui?.desktop?.refreshTray();
            gui?.runner?.runtimeChanged();
        },
        ready: (url, loginPath) => {
            gui?.billionContext?.serverReady();
            openLocal(url, loginPath);
        },
        down: () => {
            gui?.billionContext?.serverDown();
            localDown();
        },
    });

    gui.billionContext = setUpBillionContext({
        home: join(app.getPath("userData"), "billion-context"),
        platform: process.platform,
        settings: () => gui!.settings,
        dataFolder: () => gui!.local!.dataFolder(),
        local: () => {
            const local = gui!.local!;

            return { installed: local.installed(), url: local.state().status === "running" ? local.url() : undefined };
        },
        fetch: (url, headers = {}) => net.fetch(url, { headers: { "user-agent": `pi-pocket-gui/${app.getVersion()}`, ...headers } }),
        request: (url, init) => net.fetch(url, init),
        changed: () => {
            pushConfigState();
        },
    });

    gui.runner = setUpRunner({
        home: join(app.getPath("userData"), "runner"),
        platform: process.platform,
        enabled: () => gui!.settings.runner.enabled,
        setEnabled: async (enabled) => {
            const state = gui!;

            if (state.settings.runner.enabled !== enabled) {
                state.settings = { ...state.settings, runner: { enabled } };
                saveSettings(state.configPath, state.settings);
            }
        },
        runtime: () => gui!.local!.runnerRuntime(),
        // No Pi Pocket here yet: install it (it starts only in "This computer" mode). One without the runner: update it.
        prepare: async () => {
            const local = gui!.local!;

            if (!local.installed()) {
                await local.install();
            } else {
                await local.checkUpdates();
            }
        },
        environment: () => gui!.local!.environment(),
        changed: () => {
            pushConfigState();
        },
    });

    gui.desktop = setUpDesktop({
        assets: ASSETS,
        window: () => window,
        contents: () => server.webContents,
        origin: () => currentOrigin(),
        settings: () => gui!.settings,
        showingServer: () => gui?.showing === "server",
        showServer: () => {
            if (gui === undefined || gui.loadedUrl === undefined) {
                return false;
            }

            if (gui.showing !== "server") {
                gui.reason = { kind: "user" };
                show("server");
            }

            return true;
        },
        tray: () => gui?.tray,
        showWindow,
        toggleWindow,
        openSettings,
        quit,
        updateItem: () => gui?.updates?.trayItem() ?? gui?.local?.trayItem(),
        theme: () => gui!.theme,
        dictation: () => gui?.dictation?.state().supported === true,
        computerName: () => computerName(),
        linkRunner: async (server, code) => {
            await gui!.runner!.linkTo(server, code);

            // The runner runs from Pi Pocket on this computer: keep that current, also while another server is in use.
            if (gui!.settings.server.mode !== "local") {
                gui!.local!.keepCurrent();
            }
        },
        themeChanged: (next) => {
            const state = gui!;

            if (sameTheme(state.theme, next)) {
                return;
            }

            state.theme = next;
            saveTheme(state.themePath, next);
            state.appearance?.themeChanged();
            state.titleBar?.themeChanged(next);
            pushConfigState();
        },
        pageRightClick: (input) => {
            const click = readPageClick(input);
            const at = Date.now();

            if (click === undefined) {
                return;
            }

            // Electron's event, where it fires, comes with the spelling: wait a moment for it, and open from the
            // page's report only when it did not come (macOS).
            setTimeout(() => {
                const contents = gui?.server.webContents;

                if (contents === undefined || contents.isDestroyed() || eventCovered(contextMenuEventAt.get(contents.id), at)) {
                    return;
                }

                void clipboardHasContent().then((pasteable) => {
                    if (gui !== undefined && !contents.isDestroyed()) {
                        openContextMenu(gui.window, contents, pageClickInfo(click, pasteable), click, { openSettings });
                    }
                });
            }, PAGE_CLICK_WAIT_MS);
        },
    });

    for (const change of ["show", "hide", "minimize", "restore", "focus"] as const) {
        window.on(change as "show", () => gui?.desktop?.visibilityChanged());
    }

    const policy: OriginPolicy = {
        server: () => currentOrigin(),
        allowed: () => new Set([currentOrigin(), ...(gui?.settings.server.extraOrigins ?? [])]),
    };

    guardSession(serverSession, policy);
    guardContents(server.webContents, policy, openServerWindow);
    lockConfigView();
    watchServerView();
    layout();
    window.on("resize", layout);
    window.on("maximize", layout);
    window.on("unmaximize", layout);
    window.on("enter-full-screen", layout);
    window.on("leave-full-screen", layout);

    const remember = () => {
        if (!window.isMinimized() && !window.isMaximized()) {
            saveWindowState(statePath, { bounds: window.getBounds(), maximized: false });
        } else {
            saveWindowState(statePath, { bounds: window.getNormalBounds(), maximized: window.isMaximized() });
        }
    };

    window.on("close", (event) => {
        remember();

        if (gui === undefined || gui.quitting) {
            return;
        }

        if (gui.settings.window.closeToTray) {
            event.preventDefault();

            if (gui.tray !== undefined) {
                window.hide();
            } else {
                window.minimize();
            }
        }
    });
    window.on("closed", () => {
        app.quit();
    });

    app.on("second-instance", () => {
        showWindow();
    });
    let stopped = false;

    app.on("before-quit", (event) => {
        if (gui !== undefined) {
            gui.quitting = true;
        }

        // This computer's Pi Pocket stops with the app: its sessions resume at the next start.
        if (!stopped && gui?.local !== undefined) {
            event.preventDefault();
            stopped = true;
            void Promise.allSettled([gui.local.quit(), gui.runner?.quit()]).finally(() => app.quit());
        }
    });
    app.on("activate", () => {
        showWindow();
    });

    // A system shutdown or `kill`: quit the usual way, so this computer's Pi Pocket stops with the app.
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
        process.on(signal, quit);
    }
    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
        gui?.dictation?.quit();
        gui?.billionContext?.quit();
    });

    registerIpc();
    applyDesktopSettings(undefined);
    buildMenu();
    await config.webContents.loadURL(CONFIG_URL);

    if (placed.maximized) {
        window.maximize();
    }

    const hidden = gui.settings.window.startHidden && startedAtLogin() && gui.tray !== undefined;

    if (!hidden) {
        window.show();
    }

    // This computer as a runner, for whichever server it is linked to.
    gui.runner!.boot();

    // Its runner comes from Pi Pocket on this computer: keep that current also while another server is in use.
    if (gui.settings.server.mode !== "local" && gui.runner!.linked()) {
        gui.local!.keepCurrent();
    }

    // This computer's Pi Pocket: the window opens it once it is ready, and shows its state until then.
    if (gui.settings.server.mode === "local") {
        showConfig({ kind: "local" });
        void gui.local!.boot();

        return;
    }

    // First run: always show the config screen, with what the check found, so the person confirms the address.
    if (firstRun) {
        showConfig({ kind: "first-run" });

        if ((await checkAddress(gui.settings.server.url)).kind !== "detected") {
            scheduleRetry();
        }

        return;
    }

    const found = await checkAddress(gui.settings.server.url);

    if (found.kind === "detected" && gui.settings.connection.autoConnect) {
        connect(gui.settings.server.url);
    } else if (found.kind === "detected") {
        showConfig({ kind: "user" });
    } else {
        showConfig({ kind: "not-detected", probe: found });
        scheduleRetry();
    }
}

/** The address the window opens: this computer's Pi Pocket, or the server set in settings. */
function serverUrl(): string {
    const settings = gui?.settings;

    if (settings?.server.mode === "local") {
        return gui?.local?.url() ?? `http://127.0.0.1:${String(settings.local.port)}`;
    }

    return settings?.server.url ?? "";
}

function currentOrigin(): string {
    const normalized = normalizeServerUrl(serverUrl());

    return normalized.ok ? normalized.origin : "null";
}

/** This computer's Pi Pocket is ready: sign in with its login link (the cookie keeps the app signed in), and show it. */
function openLocal(url: string, loginPath: string): void {
    const state = gui!;

    if (state.settings.server.mode !== "local") {
        return;
    }

    stopRetry();
    state.reason = { kind: "user" };
    state.loadedUrl = url;
    state.unverified = false;
    state.signingIn = true;
    void checkAddress(url);
    void state.server.webContents.loadURL(`${url}${loginPath}`).catch(() => {
        // did-fail-load shows the error.
    });
    show("server");
}

/** This computer's Pi Pocket stopped, failed, or is not installed: show its state. */
function localDown(): void {
    const state = gui!;

    if (state.settings.server.mode !== "local") {
        return;
    }

    stopHealth();
    stopRetry();

    if (state.loadedUrl !== undefined) {
        state.loadedUrl = undefined;
        void state.server.webContents.loadURL("about:blank").catch(() => {});
    }

    showConfig({ kind: "local" });
}

/** Switches between this computer's Pi Pocket and another server. */
async function useMode(mode: "local" | "remote"): Promise<void> {
    const state = gui!;

    if (state.settings.server.mode === mode) {
        return;
    }

    state.settings = { ...state.settings, server: { ...state.settings.server, mode } };
    saveSettings(state.configPath, state.settings);
    stopHealth();
    stopRetry();
    state.loadedUrl = undefined;
    state.probe = undefined;
    void state.server.webContents.loadURL("about:blank").catch(() => {});

    if (mode === "local") {
        showConfig({ kind: "local" });
        await state.local!.boot();

        return;
    }

    await state.local!.stop();
    showConfig({ kind: "user" });

    if ((await checkAddress(state.settings.server.url)).kind !== "detected") {
        scheduleRetry();
    }
}

async function localAction(action: LocalAction): Promise<void> {
    const state = gui!;
    const local = state.local!;

    switch (action) {
        case "install":
            await local.install();
            break;
        case "start":
            await local.start();
            break;
        case "stop":
            await local.stop();
            break;
        case "restart":
            await local.restart();
            break;
        case "check-updates":
            await local.checkUpdates();
            break;
        case "show-log":
            shell.showItemInFolder(local.logFile);
            break;
        case "open": {
            // A Pi Pocket started outside the app answers at the port: open it as another server.
            const url = local.state().url ?? `http://127.0.0.1:${String(state.settings.local.port)}`;

            state.settings = { ...state.settings, server: { ...state.settings.server, url } };
            await useMode("remote");
            connect(url);
            break;
        }
        case "use-local":
            await useMode("local");
            break;
        case "use-remote":
            await useMode("remote");
            break;
        case "uninstall": {
            const { response } = await dialog.showMessageBox(state.window, {
                type: "warning",
                message: "Uninstall Pi Pocket from this computer?",
                detail: `This stops it and removes what the app installed for it: Node.js and Pi Pocket (${local.state().home}).\n\nYour sessions, settings, and sign-in stay in Pi Pocket's data folder. Install puts it back.`,
                buttons: ["Uninstall", "Cancel"],
                defaultId: 1,
                cancelId: 1,
            });

            if (response === 0) {
                await local.uninstall();
            }

            break;
        }
    }
}

async function billionContextAction(action: BillionContextAction): Promise<void> {
    const state = gui!;
    const extension = state.billionContext!;

    switch (action) {
        case "install":
            await extension.install();
            break;
        case "update":
            await extension.update();
            break;
        case "check":
            await extension.check();
            break;
        case "enable":
            await extension.enable();
            break;
        case "disable":
            await extension.disable();
            break;
        case "show-folder":
            shell.showItemInFolder(join(extension.state().folder, ADAPTER.file));
            break;
        case "open-page":
            void shell.openExternal(ADAPTER_PAGE);
            break;
        case "uninstall": {
            const { response } = await dialog.showMessageBox(state.window, {
                type: "warning",
                message: "Remove billion-context-pi from this computer's Pi Pocket?",
                detail: `This turns it off and removes its files from ${extension.state().folder}.\n\nIts settings file and its saved compression state stay. Install puts it back.`,
                buttons: ["Remove", "Cancel"],
                defaultId: 1,
                cancelId: 1,
            });

            if (response === 0) {
                await extension.uninstall();
            }

            break;
        }
    }
}

function layout(): void {
    if (gui === undefined) {
        return;
    }

    const { width, height } = gui.window.getContentBounds();
    // Below the title bar's strip only when the page could not be told to keep clear of it (src/main/titlebar.ts).
    const top = gui.titleBar?.offset() ?? 0;

    const recovery = gui.showing === "server" && gui.unverified ? Math.min(48, height) : 0;

    gui.server.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top - recovery) });
    gui.config.setBounds({ x: 0, y: recovery > 0 ? height - recovery : 0, width, height: recovery > 0 ? recovery : height });
}

function show(which: "server" | "config"): void {
    if (gui === undefined) {
        return;
    }

    gui.showing = which;
    gui.server.setVisible(which === "server");
    gui.config.setVisible(which === "config" || gui.unverified);
    layout();
    (which === "server" ? gui.server : gui.config).webContents.focus();
    gui.window.setTitle(which === "server" ? gui.server.webContents.getTitle() || "Pi Pocket" : "Pi Pocket — Server settings");
    gui.desktop?.visibilityChanged();
    pushConfigState();
}

function showWindow(): void {
    if (gui === undefined) {
        return;
    }

    if (gui.window.isMinimized()) {
        gui.window.restore();
    }

    gui.window.show();
    gui.window.focus();
}

function toggleWindow(): void {
    if (gui === undefined) {
        return;
    }

    if (gui.window.isVisible() && gui.window.isFocused()) {
        if (gui.tray !== undefined) {
            gui.window.hide();
        } else {
            gui.window.minimize();
        }
    } else {
        showWindow();
    }
}

// ——— The config screen ———

function configState(): ConfigState {
    const state = gui!;

    return {
        settings: state.settings,
        defaults: defaultSettings(),
        problems: state.problems,
        configPath: state.configPath,
        reason: state.reason,
        ...(state.probe === undefined ? {} : { probe: state.probe }),
        ...(state.retry === undefined ? {} : { nextRetryAt: state.retry.at }),
        ...(state.loadedUrl === undefined ? {} : { connectedUrl: state.loadedUrl }),
        canReturn: state.loadedUrl !== undefined,
        recovery: state.showing === "server" && state.unverified,
        trayAvailable: state.trayAvailable,
        translucency: state.appearance?.support() ?? { kind: "unsupported", message: "" },
        translucentAtStart: state.translucentAtStart,
        titleBarAtStart: state.titleBarAtStart,
        theme: state.theme,
        platform: process.platform,
        appVersion: app.getVersion(),
        update: state.updates?.state() ?? { method: "source", status: "idle" },
        local: state.local!.state(),
        dictation: state.dictation!.state(),
        billionContext: state.billionContext!.state(),
        runner: state.runner!.state(),
    };
}

function pushConfigState(): void {
    if (gui !== undefined && !gui.config.webContents.isDestroyed()) {
        gui.config.webContents.send("config:state", configState());
    }
}

function showConfig(reason: ConfigReason): void {
    if (gui === undefined) {
        return;
    }

    gui.reason = reason;
    show("config");
}

/** The config page may only be the app's own page: it never navigates or opens windows. */
function lockConfigView(): void {
    const contents = gui!.config.webContents;

    contents.on("will-navigate", (event) => {
        // Its own pages only (a reload): links in it go through the main process.
        if (!isAppPage(event.url)) {
            event.preventDefault();
        }
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

async function checkAddress(url: string): Promise<ProbeResult> {
    const state = gui!;
    const serverSession = session.fromPartition(SERVER_PARTITION);
    const result = await probe(
        url,
        (target, init) => serverSession.fetch(target, init),
        state.settings.connection.probeTimeoutMs,
    );

    if (sameAddress(url, serverUrl())) {
        state.probe = result;

        if (result.kind === "detected" && state.unverified) {
            state.unverified = false;
            layout();
            state.config.setVisible(state.showing === "config");
        }

        pushConfigState();
    }

    return result;
}

function sameAddress(a: string, b: string): boolean {
    const left = normalizeServerUrl(a);
    const right = normalizeServerUrl(b);

    return left.ok && right.ok && left.url === right.url;
}

// ——— Connecting ———

function connect(url: string, unverified = false): void {
    const state = gui!;
    const normalized = normalizeServerUrl(url);

    if (!normalized.ok) {
        showConfig({ kind: "not-detected", probe: { kind: "invalid", url, message: normalized.message } });

        return;
    }

    if (normalized.url !== state.settings.server.url) {
        state.settings = { ...state.settings, server: { ...state.settings.server, url: normalized.url } };
        saveSettings(state.configPath, state.settings);
    } else if (!existsSync(state.configPath)) {
        saveSettings(state.configPath, state.settings);
    }

    stopRetry();
    state.retryAttempt = 0;
    state.reason = { kind: "user" };
    state.unverified = unverified;

    if (state.loadedUrl !== undefined && sameAddress(state.loadedUrl, normalized.url)) {
        show("server");
        startHealth();

        return;
    }

    state.loadedUrl = normalized.url;
    void state.server.webContents.loadURL(`${normalized.url}/`).catch(() => {
        // did-fail-load shows the error.
    });
    show("server");
    startHealth();
}

function watchServerView(): void {
    const contents = gui!.server.webContents;

    const responses = new NavigationResponses();
    const contentsId = contents.id;

    contents.on("did-start-navigation", (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
            responses.started();
        }
    });

    // Record before commitment, but do not change UI here: an attachment has headers yet never replaces the page.
    contents.session.webRequest.onHeadersReceived((details, callback) => {
        if (details.webContentsId === contentsId && details.resourceType === "mainFrame") {
            const type = Object.entries(details.responseHeaders ?? {}).find(([name]) => name.toLowerCase() === "content-type")?.[1][0] ?? "";

            responses.received(details.url, type);
        }

        callback({});
    });

    // These belong to the app, not to the server's HTML, CSS, or keyboard handlers.
    contents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "," && (process.platform === "darwin" ? input.meta : input.control) && !input.alt) {
            event.preventDefault();
            openSettings();
        }
    });
    contents.on("context-menu", (_event, params) => {
        contextMenuEventAt.set(contents.id, Date.now());
        openContextMenu(gui!.window, contents, params, params, { openSettings });
    });

    contents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
        // -3 is ERR_ABORTED: a navigation that another one replaced, not a failure.
        if (!isMainFrame || code === -3 || gui === undefined) {
            return;
        }

        gui.loadedUrl = undefined;
        stopHealth();
        showConfig({ kind: "load-failed", url, message: networkMessage(new Error(description), gui.settings.connection.probeTimeoutMs) });
        scheduleRetry();
    });

    contents.on("render-process-gone", (_event, details) => {
        if (gui === undefined || details.reason === "clean-exit") {
            return;
        }

        gui.loadedUrl = undefined;
        stopHealth();
        showConfig({ kind: "crashed", message: `The page stopped (${details.reason}).` });
        scheduleRetry();
    });

    contents.on("page-title-updated", (_event, title) => {
        if (gui?.showing === "server") {
            gui.window.setTitle(title || "Pi Pocket");
        }
    });

    // Only a committed main-frame navigation replaces the page. Downloads and subresource errors leave it alone.
    contents.on("did-navigate", (_event, url, status) => {
        gui?.desktop?.reset();
        const message = responses.committed(url, status, gui?.unverified ?? false);

        if (gui !== undefined && gui.loadedUrl !== undefined && message !== undefined) {
            gui.loadedUrl = undefined;
            gui.unverified = false;
            stopHealth();
            stopRetry();
            showConfig({ kind: "load-failed", url: serverUrl(), message });
        }
    });

    contents.on("did-finish-load", () => {
        // The login link is spent: Back must not go to it.
        if (gui?.signingIn === true && !contents.getURL().includes("/login")) {
            gui.signingIn = false;
            contents.navigationHistory.clear();
        }

        tellNoBridge();

        // After a sign-in redirects back, detection can succeed and remove the recovery footer.
        if (gui?.unverified) {
            void checkAddress(gui.settings.server.url);
        }
    });

    // Each document starts without the see-through CSS: give it again as soon as there is a page to give it to.
    contents.on("dom-ready", () => {
        gui?.appearance?.pageLoaded();
    });
}

/**
 * Once in each run: a server without the bridge (an older Pi Pocket) still works, but without the badge, pins, and
 * notifications. Say so, on the server's own address only.
 */
function tellNoBridge(): void {
    const state = gui!;
    const probe = state.probe;

    if (
        state.loadedUrl === undefined ||
        state.toldNoBridge ||
        probe?.kind !== "detected" ||
        probe.bridge > 0 ||
        originOf(state.server.webContents.getURL()) !== currentOrigin()
    ) {
        return;
    }

    state.toldNoBridge = true;
    void dialog.showMessageBox(state.window, {
        type: "info",
        title: "Pi Pocket",
        message: "This server doesn't support desktop features yet.",
        detail: "Please update it. Until then, the tray's pins, the badge, and native notifications stay off; everything else works.",
        buttons: ["OK"],
    });
}

function originOf(url: string): string | undefined {
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}

/** When each page's last `context-menu` event came: a report from its preload for the same click then opens nothing. */
const contextMenuEventAt = new Map<number, number>();

/** The menus drawn so far: each is waited for by its number. */
let menusDrawn = 0;

/**
 * The right-click menu on one of the server's pages: `contextMenuTemplate`'s items, drawn in the page in Pi Pocket's
 * theme (src/main/themed-menu.ts). Where the page cannot draw it, the same template pops up as the native menu.
 */
function openContextMenu(
    window: BaseWindow,
    contents: WebContents,
    click: ClickInfo,
    at: { x: number; y: number },
    actions: Pick<MenuActions, "openSettings">,
): void {
    const template = contextMenuTemplate(click, { ...spelling(contents), ...actions });
    const native = (): void => {
        if (!contents.isDestroyed() && !window.isDestroyed()) {
            Menu.buildFromTemplate(template).popup({ window });
        }
    };
    const mac = process.platform === "darwin";
    const key = ++menusDrawn;
    const script = menuScript(key, {
        groups: themedGroups(template, mac),
        x: at.x,
        y: at.y,
        label: "Pi Pocket",
        sheet: menuSheet(gui!.theme),
    });

    contents.executeJavaScriptInIsolatedWorld(MENU_WORLD, [{ code: script }], true).then(
        (shown: unknown) => {
            if (shown !== true) {
                native();

                return;
            }

            contents.executeJavaScriptInIsolatedWorld(MENU_WORLD, [{ code: pickScript(key) }], true).then(
                (id: unknown) => {
                    if (!contents.isDestroyed()) {
                        runPicked(template, id, {
                            cut: () => contents.cut(),
                            copy: () => contents.copy(),
                            paste: () => contents.paste(),
                            selectAll: () => contents.selectAll(),
                        });
                    }
                },
                // The page went away with the menu open: there is nothing left to act on.
                () => undefined,
            );
        },
        native,
    );
}

/** Something to paste: what Chromium checks before it enables Paste. */
async function clipboardHasContent(): Promise<boolean> {
    try {
        return (await clipboard.read()).some((item) => item.types.length > 0);
    } catch {
        return true;
    }
}

/** The right-click menu's spelling actions on a page: replace the word clicked, or add it to the dictionary. */
function spelling(contents: WebContents): { replace: (word: string) => void; learn: (word: string) => void } {
    return {
        replace: (word) => contents.replaceMisspelling(word),
        learn: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    };
}

/** Opens one of the server's own pages that asked for a new window: in a plain window of this app, or outside. */
function openServerWindow(url: string): void {
    const state = gui!;

    if (state.settings.window.sameOriginLinks === "browser") {
        openOutside(url);

        return;
    }

    const child = new BrowserWindow({
        width: 1100,
        height: 800,
        icon: join(ASSETS, "icon-512.png"),
        autoHideMenuBar: !state.settings.window.showMenuBar,
        backgroundColor: "#1a1b26",
        webPreferences: {
            session: session.fromPartition(SERVER_PARTITION),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
        },
    });
    const policy: OriginPolicy = {
        server: () => currentOrigin(),
        allowed: () => new Set([currentOrigin(), ...(gui?.settings.server.extraOrigins ?? [])]),
    };

    guardContents(child.webContents, policy, openServerWindow);
    child.webContents.on("context-menu", (_event, params: ContextMenuParams) => {
        openContextMenu(child, child.webContents, params, params, {});
    });
    // The caption buttons' nativeTheme is process-wide: this window is given the system's scheme, and until it is,
    // nativeTheme stays "system" (src/main/titlebar.ts). Registered before loading, which the protocol needs first.
    void state.titleBar?.followSystemScheme(child.webContents);
    void child.loadURL(url);
}

// ——— Retrying while the server cannot be reached ———

/**
 * While the config screen shows a server that does not answer, it is checked again and again, each wait longer, up
 * to the longest wait in settings. When it answers: after an outage or a failed load the app goes back to it; on the
 * first run, or when the person opened the screen themselves, it only says "Detected" and waits for them.
 */
function scheduleRetry(): void {
    const state = gui!;

    stopRetry();

    // This computer's Pi Pocket: its process says when it is up, nothing to poll.
    if (state.settings.server.mode === "local") {
        return;
    }
    state.retryAttempt += 1;

    const delay = retryDelayMs(state.retryAttempt, state.settings.connection.retryMaxSeconds);

    state.retry = {
        at: Date.now() + delay,
        timer: setTimeout(() => {
            void retry();
        }, delay),
    };
    pushConfigState();
}

function stopRetry(): void {
    if (gui?.retry !== undefined) {
        clearTimeout(gui.retry.timer);
        gui.retry = undefined;
        pushConfigState();
    }
}

/** The config screen opened because the server failed, not because the person asked: go back once it answers. */
function returnsByItself(reason: ConfigReason): boolean {
    return reason.kind === "outage" || reason.kind === "load-failed" || reason.kind === "not-detected";
}

async function retry(): Promise<void> {
    const state = gui!;

    state.retry = undefined;

    const found = await checkAddress(state.settings.server.url);

    if (state.showing !== "config" || state.retry !== undefined) {
        return;
    }

    if (found.kind === "detected") {
        state.retryAttempt = 0;

        if (returnsByItself(state.reason) && state.settings.connection.autoConnect) {
            connect(state.settings.server.url);
        } else {
            pushConfigState();
        }

        return;
    }

    if (state.reason.kind === "not-detected") {
        state.reason = { kind: "not-detected", probe: found };
    }

    scheduleRetry();
}

// ——— Watching the server while it is open ———

function startHealth(): void {
    const state = gui!;
    const seconds = state.settings.connection.healthIntervalSeconds;

    stopHealth();

    if (seconds === 0 || state.settings.server.mode === "local") {
        return;
    }

    const tick = async () => {
        if (gui?.health === undefined) {
            return;
        }

        const found = await checkAddress(gui.settings.server.url);

        if (gui.health === undefined) {
            return;
        }

        if (found.kind === "unreachable") {
            gui.health.failures += 1;

            if (gui.health.failures >= gui.settings.connection.failuresBeforeOutage) {
                stopHealth();
                gui.loadedUrl = undefined;
                showConfig({ kind: "outage", url: found.url, message: found.message });
                scheduleRetry();

                return;
            }
        } else {
            gui.health.failures = 0;
        }

        gui.health.timer = setTimeout(() => void tick(), gui.settings.connection.healthIntervalSeconds * 1000);
    };

    state.health = { failures: 0, timer: setTimeout(() => void tick(), seconds * 1000) };
}

function stopHealth(): void {
    if (gui?.health !== undefined) {
        clearTimeout(gui.health.timer);
        gui.health = undefined;
    }
}

// ——— Settings that act on the desktop ———

function applyDesktopSettings(before: Settings | undefined): void {
    const state = gui!;
    const settings = state.settings;

    state.window.setAutoHideMenuBar(!settings.window.showMenuBar);
    state.window.setMenuBarVisibility(settings.window.showMenuBar);

    if (before === undefined || before.window.launchAtLogin !== settings.window.launchAtLogin) {
        // Writing the login item at every start would undo a change made in the system's settings; only on change.
        if (before !== undefined) {
            try {
                setLaunchAtLogin(settings.window.launchAtLogin);
            } catch (error) {
                state.problems = [
                    ...state.problems,
                    { path: "window.launchAtLogin", message: `could not be set: ${(error as Error).message}` },
                ];
            }
        }
    }

    globalShortcut.unregisterAll();

    if (settings.window.hotkeyEnabled) {
        let ok = false;

        try {
            ok = globalShortcut.register(settings.window.hotkey, toggleWindow);
        } catch {
            ok = false;
        }

        if (!ok) {
            state.problems = [
                ...state.problems.filter((problem) => problem.path !== "window.hotkey"),
                { path: "window.hotkey", message: "could not be registered: another app may use it" },
            ];
        }
    }

    if (state.tray === undefined && state.trayAvailable) {
        state.tray = createTray();
    }

    state.appearance?.apply(settings);
    state.desktop?.refreshTray();
}

/** The tray icon. Its menu and image (the pins, a dot when sessions need you) come from src/main/desktop.ts. */
function createTray(): Tray {
    const image = nativeImage.createFromPath(join(ASSETS, "icon-192.png")).resize({ width: 22, height: 22 });
    const tray = new Tray(image);

    tray.setToolTip("Pi Pocket");

    // On macOS a menu-bar icon only opens its menu, as every other one there does; "Open Pi Pocket" in it shows the
    // window. Elsewhere a click on the tray icon shows or hides the window, and right-click opens the menu.
    if (process.platform !== "darwin") {
        tray.on("click", toggleWindow);
    }

    return tray;
}

function openSettings(): void {
    if (gui !== undefined) {
        gui.connectionAttempt++;
    }

    showWindow();
    showConfig({ kind: "user" });
}

function quit(): void {
    if (gui !== undefined) {
        gui.quitting = true;
    }

    app.quit();
}

function buildMenu(): void {
    const mac = process.platform === "darwin";
    const template: MenuItemConstructorOptions[] = [
        ...(mac ? [{ role: "appMenu" as const }] : []),
        {
            label: "File",
            submenu: [
                { label: "Server settings…", accelerator: "CommandOrControl+,", click: openSettings },
                { type: "separator" },
                mac ? { role: "close" } : { label: "Quit", accelerator: "CommandOrControl+Q", click: quit },
            ],
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                {
                    label: "Reload",
                    accelerator: "CommandOrControl+R",
                    click: () => {
                        (gui?.showing === "config" ? gui.config : gui?.server)?.webContents.reload();
                    },
                },
                {
                    label: "Developer tools",
                    accelerator: mac ? "Alt+Command+I" : "Control+Shift+I",
                    click: () => {
                        (gui?.showing === "config" ? gui.config : gui?.server)?.webContents.toggleDevTools();
                    },
                },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" },
            ],
        },
        { role: "windowMenu" },
        {
            role: "help",
            submenu: [
                { label: "Pi Pocket on GitHub", click: () => void shell.openExternal(LINKS.github) },
                { label: "Pi Pocket's documentation", click: () => void shell.openExternal(LINKS.docs) },
                { label: "This app's releases", click: () => void shell.openExternal(LINKS.releases) },
            ],
        },
    ];

    // The zoom and reload roles act on the focused view, which is the one showing.
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ——— Calls from the config page ———

function fromConfigPage(event: IpcMainInvokeEvent): boolean {
    const frame = event.senderFrame;

    return (
        gui !== undefined &&
        event.sender === gui.config.webContents &&
        frame !== null &&
        frame.parent === null &&
        isAppPage(frame.url)
    );
}

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
    ipcMain.handle(channel, (event, ...args) => {
        if (!fromConfigPage(event)) {
            throw new Error("Not allowed");
        }

        return listener(event, ...args);
    });
}

function registerIpc(): void {
    handle("config:state", () => configState());

    handle("config:probe", async (_event, url) => {
        if (typeof url !== "string") {
            throw new Error("Not an address");
        }

        // The person checks another address: the background tries of the saved one would only confuse.
        if (!sameAddress(url, gui!.settings.server.url)) {
            stopRetry();
        }

        return checkAddress(url);
    });

    handle("config:save", (_event, input) => {
        const state = gui!;
        const before = state.settings;
        const checked = validateSettings(input);

        state.settings = checked.settings;
        state.problems = checked.problems;
        saveSettings(state.configPath, state.settings);
        applyDesktopSettings(before);
        state.dictation?.settingsChanged();
        state.updates?.reschedule();
        state.local?.rescheduleUpdates();
        state.billionContext?.reschedule();

        if (before.runner.enabled !== state.settings.runner.enabled) {
            state.runner?.enabledChanged();
        }

        if (!sameAddress(before.server.url, state.settings.server.url)) {
            state.probe = undefined;
        }

        if (state.health !== undefined) {
            startHealth();
        }

        return configState();
    });

    handle("config:connect", async (_event, url, allowUnverified) => {
        if (typeof url !== "string") {
            throw new Error("Not an address");
        }

        const state = gui!;
        const attempt = ++state.connectionAttempt;

        stopRetry();
        const found = await checkAddress(url);

        if (gui !== state || attempt !== state.connectionAttempt) {
            return found;
        }

        // Enforce this at the IPC boundary too: never save/navigate to an API error or an unreachable address.
        if (mayConnect(found, allowUnverified === true)) {
            state.probe = found;
            connect(found.url, found.kind !== "detected");
        } else {
            showConfig({ kind: "not-detected", probe: found });
        }

        return found;
    });

    handle("config:open-settings", openSettings);

    handle("config:back", () => {
        const state = gui!;

        state.connectionAttempt++;

        if (state.loadedUrl !== undefined) {
            state.reason = { kind: "user" };
            show("server");
        }
    });

    handle("config:retry", async () => {
        stopRetry();

        const state = gui!;

        if (state.settings.server.mode === "local") {
            if (state.loadedUrl !== undefined) {
                state.server.webContents.reload();
                show("server");
            } else {
                await state.local!.start();
            }

            return;
        }

        state.retryAttempt = 0;

        const found = await checkAddress(state.settings.server.url);

        if (found.kind === "detected") {
            connect(state.settings.server.url);
        } else {
            if (state.reason.kind === "not-detected") {
                state.reason = { kind: "not-detected", probe: found };
            }

            scheduleRetry();
        }
    });

    handle("config:open-external", (_event, target) => {
        if (target === "github" || target === "docs" || target === "releases") {
            void shell.openExternal(LINKS[target]);
        }
    });

    handle("config:check-updates", () => gui!.updates?.check(true));

    handle("config:update-action", () => gui!.updates?.act());

    handle("config:local", (_event, action) => {
        const actions: LocalAction[] = ["install", "start", "stop", "restart", "open", "check-updates", "show-log", "use-local", "use-remote", "uninstall"];

        if (typeof action !== "string" || !(actions as string[]).includes(action)) {
            throw new Error("Not an action");
        }

        return localAction(action as LocalAction);
    });

    handle("config:runner", async (_event, action) => {
        const runner = gui!.runner!;

        switch (action) {
            case "unlink": {
                const link = runner.link();
                const answer = await dialog.showMessageBox(gui!.window, {
                    type: "question",
                    buttons: ["Unlink", "Cancel"],
                    defaultId: 1,
                    cancelId: 1,
                    message: "Unlink this computer?",
                    detail: `The runner stops, and ${link?.server ?? "the server"} can no longer run sessions' tools here. Remove "${link?.name ?? "this computer"}" under Menu → Runners there too.`,
                });

                if (answer.response === 0) {
                    await runner.unlink();
                }

                return;
            }
            case "restart":
                return runner.restart();
            default:
                throw new Error("Unknown runner action");
        }
    });

    handle("config:billion-context", (_event, action) => {
        const actions: BillionContextAction[] = ["install", "update", "uninstall", "check", "enable", "disable", "show-folder", "open-page"];

        if (typeof action !== "string" || !(actions as string[]).includes(action)) {
            throw new Error("Not an action");
        }

        return billionContextAction(action as BillionContextAction);
    });

    handle("config:dictation", (_event, action) => {
        const value = action as Partial<DictationAction> | null;

        if (
            typeof value !== "object" ||
            value === null ||
            typeof value.id !== "string" ||
            !["download", "cancel", "remove", "use"].includes(String(value.type))
        ) {
            throw new Error("Not an action");
        }

        // A download runs on: its progress shows through the state.
        const done = gui!.dictation!.act(value as DictationAction);

        if (value.type === "download") {
            done.catch((error: unknown) => {
                console.error(error);
            });

            return undefined;
        }

        return done;
    });

    handle("config:show-dictation-folder", () => {
        const folder = gui!.dictation!.state().folder;

        void shell.openPath(existsSync(folder) ? folder : app.getPath("userData"));
    });

    handle("config:choose-folder", async (_event, start) => {
        const result = await dialog.showOpenDialog(gui!.window, {
            properties: ["openDirectory", "createDirectory"],
            ...(typeof start === "string" && start !== "" ? { defaultPath: start } : {}),
        });

        return result.canceled ? undefined : result.filePaths[0];
    });

    handle("config:relaunch", () => {
        gui!.quitting = true;
        app.relaunch();
        app.quit();
    });

    handle("config:show-file", () => {
        const state = gui!;

        if (!existsSync(state.configPath)) {
            saveSettings(state.configPath, state.settings);
        }

        shell.showItemInFolder(state.configPath);
    });
}
