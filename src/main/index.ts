/**
 * The main process. One window holds two views: the server's page (Pi Pocket itself) and the app's config screen. The
 * server's page stays loaded while the config screen shows, so going back is instant and nothing it was doing stops.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
    app,
    BaseWindow,
    BrowserWindow,
    globalShortcut,
    ipcMain,
    Menu,
    nativeImage,
    session,
    shell,
    Tray,
    WebContentsView,
    type IpcMainInvokeEvent,
    type MenuItemConstructorOptions,
} from "electron";
import type { ConfigReason, ConfigState, ProbeResult, Settings, SettingsProblem } from "../shared/types";
import { retryDelayMs } from "./backoff";
import { CONFIG_URL, isAppPage, registerAppScheme, serveAppPages } from "./config-protocol";
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
    /** The next automatic check while the config screen shows a server that does not answer. */
    retry: { timer: NodeJS.Timeout; at: number } | undefined;
    /** Checks that failed in a row: the wait grows with each. */
    retryAttempt: number;
    health: { timer: NodeJS.Timeout; failures: number } | undefined;
    quitting: boolean;
}

let gui: Gui | undefined;

async function start(): Promise<void> {
    await app.whenReady();

    const configPath = join(app.getPath("userData"), "config.json");
    const firstRun = !existsSync(configPath);
    const loaded = loadSettings(configPath);
    const statePath = join(app.getPath("userData"), "window-state.json");
    const placed = loadWindowState(statePath);

    const window = new BaseWindow({
        title: "Pi Pocket",
        width: placed.bounds.width,
        height: placed.bounds.height,
        ...(placed.placed ? { x: placed.bounds.x, y: placed.bounds.y } : {}),
        minWidth: 360,
        minHeight: 480,
        show: false,
        backgroundColor: "#1a1b26",
        icon: join(ASSETS, "icon-512.png"),
        autoHideMenuBar: !loaded.settings.window.showMenuBar,
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

    server.setBackgroundColor("#1a1b26");
    config.setBackgroundColor("#1a1b26");
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
        retry: undefined,
        retryAttempt: 0,
        health: undefined,
        quitting: false,
    };

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
    app.on("before-quit", () => {
        if (gui !== undefined) {
            gui.quitting = true;
        }
    });
    app.on("activate", () => {
        showWindow();
    });
    app.on("will-quit", () => {
        globalShortcut.unregisterAll();
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

function currentOrigin(): string {
    const normalized = normalizeServerUrl(gui?.settings.server.url ?? "");

    return normalized.ok ? normalized.origin : "null";
}

function layout(): void {
    if (gui === undefined) {
        return;
    }

    const { width, height } = gui.window.getContentBounds();
    const bounds = { x: 0, y: 0, width, height };

    gui.server.setBounds(bounds);
    gui.config.setBounds(bounds);
}

function show(which: "server" | "config"): void {
    if (gui === undefined) {
        return;
    }

    gui.showing = which;
    gui.server.setVisible(which === "server");
    gui.config.setVisible(which === "config");
    (which === "server" ? gui.server : gui.config).webContents.focus();
    gui.window.setTitle(which === "server" ? gui.server.webContents.getTitle() || "Pi Pocket" : "Pi Pocket — Server settings");
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
        canReturn: state.loadedUrl !== undefined && state.reason.kind === "user",
        trayAvailable: state.trayAvailable,
        platform: process.platform,
        appVersion: app.getVersion(),
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
    pushConfigState();
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

    if (sameAddress(url, state.settings.server.url)) {
        state.probe = result;
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

function connect(url: string): void {
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

    if (seconds === 0) {
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
}

function createTray(): Tray {
    const image = nativeImage.createFromPath(join(ASSETS, "icon-192.png")).resize({ width: 22, height: 22 });
    const tray = new Tray(image);

    tray.setToolTip("Pi Pocket");
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: "Open Pi Pocket", click: showWindow },
            { label: "Server settings…", click: openSettings },
            { type: "separator" },
            { label: "Quit", click: quit },
        ]),
    );
    tray.on("click", toggleWindow);

    return tray;
}

function openSettings(): void {
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

        if (!sameAddress(before.server.url, state.settings.server.url)) {
            state.probe = undefined;
        }

        if (state.health !== undefined) {
            startHealth();
        }

        return configState();
    });

    handle("config:connect", (_event, url) => {
        if (typeof url !== "string") {
            throw new Error("Not an address");
        }

        connect(url);
    });

    handle("config:back", () => {
        const state = gui!;

        if (state.loadedUrl !== undefined) {
            state.reason = { kind: "user" };
            show("server");
        }
    });

    handle("config:retry", async () => {
        stopRetry();

        const state = gui!;

        if (state.reason.kind === "crashed") {
            connect(state.settings.server.url);

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

    handle("config:show-file", () => {
        const state = gui!;

        if (!existsSync(state.configPath)) {
            saveSettings(state.configPath, state.settings);
        }

        shell.showItemInFolder(state.configPath);
    });
}
