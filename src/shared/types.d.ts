/**
 * Types shared by the main process, the preloads, and the config page. Types only: a sandboxed preload cannot load a
 * module of its own, so nothing here may exist at run time.
 */

/** When a notification about an approval offers Allow. Deny is always offered. */
export type AllowFromNotification = "whenFullyShown" | "always" | "never";

/** Where a link to the server's own pages that asks for a new window opens: a plain window of this app (signed in), or the system browser. */
export type SameOriginLinks = "appWindow" | "browser";

/** The blur macOS draws under a see-through window (Electron's vibrancy types). */
export type MacMaterial = "under-window" | "sidebar" | "hud" | "fullscreen-ui";

/** The blur Windows 11 draws under a see-through window. */
export type WindowsMaterial = "acrylic" | "mica";

/**
 * How the tray menu looks on Windows. "windows" follows the Windows app theme; "theme" follows Pi Pocket, like its
 * session menu. Other desktops keep their native menu and ignore this.
 */
export type TrayMenuStyle = "windows" | "theme";

/** Whether this desktop can make the window see-through now, and what it blurs with. */
export type TranslucencySupport =
    | { kind: "live"; blur: "system" | "compositor" }
    /** Linux: a window is see-through only when made so, so turning it on needs a restart. */
    | { kind: "restart" }
    | { kind: "unsupported"; message: string };

/** Where Pi Pocket runs: on this computer, started by the app, or elsewhere, opened by its address. */
export type ServerMode = "local" | "remote";

/** Who can reach this computer's Pi Pocket: Pi Pocket's own `--access` choices. */
export type LocalAccess = "local" | "lan" | "tailscale" | "cloudflare";

/** Every setting, as stored in config.json. */
export interface Settings {
    server: {
        mode: ServerMode;
        /** Another server's address: scheme, host, port, and an optional path. */
        url: string;
        /** Other origins the window may load, e.g. a sign-in page in front of the server (Cloudflare Access). */
        extraOrigins: string[];
    };
    connection: {
        /** Open the server at start when it answers, instead of the config screen. */
        autoConnect: boolean;
        /** How long one check of the server may take. */
        probeTimeoutMs: number;
        /** The longest wait between two tries while the server cannot be reached. */
        retryMaxSeconds: number;
        /** While connected, how often the server is checked. 0 turns the checks off. */
        healthIntervalSeconds: number;
        /** Failed checks in a row before the config screen shows the outage. */
        failuresBeforeOutage: number;
    };
    window: {
        /** Closing the window hides it in the tray (minimizes it when there is no tray). */
        closeToTray: boolean;
        /** Start the app when you sign in to the computer. */
        launchAtLogin: boolean;
        /** Start hidden in the tray. */
        startHidden: boolean;
        /** Always show the menu bar (Linux and Windows); otherwise Alt shows it. */
        showMenuBar: boolean;
        /** Seamless: no title bar, Pi Pocket up to the top edge under the window's controls. Takes a restart. */
        titleBar: TitleBarStyle;
        /** A global shortcut that shows or hides the window. */
        hotkeyEnabled: boolean;
        /** Electron accelerator syntax, e.g. "CommandOrControl+Shift+P". */
        hotkey: string;
        sameOriginLinks: SameOriginLinks;
    };
    notifications: {
        enabled: boolean;
        /** Play the system's sound. */
        sound: boolean;
        allowFromNotification: AllowFromNotification;
        /** The longest call text an approval notification shows; longer ones are cut and marked. */
        maxCallLength: number;
    };
    updates: {
        /** Look for new versions of this app. Pi Pocket itself updates on the server. */
        check: boolean;
        intervalHours: number;
    };
    /** This computer's Pi Pocket (src/main/local-server.ts). A change takes a restart of it. */
    local: {
        /** The folder new sessions start in; empty: the home folder. */
        folder: string;
        port: number;
        access: LocalAccess;
        /** Pi Pocket's data (sessions, people, settings); empty: ~/.pi-pocket, as Pi Pocket in a terminal. */
        data: string;
        /** The app installs new versions of Pi Pocket and Node.js for it, for its next start. */
        keepUpdated: boolean;
    };
    appearance: {
        /** A see-through window, blurred where the desktop can: the page's grounds let the desktop show. */
        translucent: boolean;
        /** How solid the page's grounds stay, in percent: 100 hides the desktop, 40 shows it most. */
        opacity: number;
        macMaterial: MacMaterial;
        windowsMaterial: WindowsMaterial;
        /**
         * The tray menu on Windows: the Windows look, or Pi Pocket's theme. macOS and Linux keep their native menu and
         * ignore this.
         */
        trayMenu: TrayMenuStyle;
    };
    dictation: {
        /** The speech model Pi Pocket's mic button uses, by id (src/main/dictation-catalog.ts); empty: none downloaded. */
        model: string;
        /** Show the words while a phrase is spoken (recognises it more than once: more CPU). */
        live: boolean;
    };
    billionContext: {
        /** Install newer versions of the billion-context-pi adapter in this computer's Pi Pocket without asking. */
        autoUpdate: boolean;
    };
    /** This computer as a runner for a Pi Pocket server (src/main/runner.ts). */
    runner: {
        /** Run `pi-pocket runner` while the app runs, once this computer is linked. */
        enabled: boolean;
    };
}

/** This computer as a runner (src/main/runner.ts). */
export interface RunnerState {
    /**
     * unlinked: no link yet. off: linked, turned off. connecting: started, not connected yet (or reconnecting).
     * connected: the server can run sessions' tools here. failed: it stopped and starts again. ended: the server ended
     * the link (the computer was removed): link again. stopping: on its way off.
     */
    status: "unlinked" | "off" | "connecting" | "connected" | "failed" | "ended" | "stopping";
    message?: string;
    /** The server this computer is linked to, and its name there. */
    link?: { server: string; id: string; name: string };
    /** A step under way (installing Pi Pocket for it, linking). */
    busy?: string;
    enabled: boolean;
    /** An installed Pi Pocket on this computer has the runner. */
    available: boolean;
    /** The name this computer suggests for itself. */
    computerName: string;
    log: string[];
}

export type RunnerAction = "unlink" | "restart";

/** One speech model, as the settings show it. */
export interface DictationModelState {
    id: string;
    name: string;
    languages: string;
    note: string;
    license: string;
    /** Bytes to download. */
    size: number;
    recommended: boolean;
    installed: boolean;
    chosen: boolean;
    /** While it downloads. */
    download?: { step: string; percent: number };
}

/** Offline dictation (src/main/dictation.ts). */
export interface DictationState {
    /** The speech engine exists for this computer's system and processor. */
    supported: boolean;
    status: "idle" | "loading" | "ready" | "listening" | "error";
    message?: string;
    /** The engine downloads with the first model and goes with the last. */
    engine: { installed: boolean; size: number };
    /** Where the engine and models are kept. */
    folder: string;
    models: DictationModelState[];
    downloading: boolean;
}

/** billion-context-pi in this computer's Pi Pocket (src/main/billion-context.ts). */
export interface BillionContextState {
    /** Where Pi Pocket runs: another server (instructions only), or this computer's, not installed, stopped, or running. */
    server: "remote" | "absent" | "stopped" | "running";
    /** The adapter in Pi Pocket's drop-in folder. */
    installed?: {
        /** billion-context-pi's version. */
        version: string;
        /** The adapter's commit, when the app installed it. */
        commit?: string;
        /** On in Pi Pocket; unknown while Pi Pocket is not running. */
        enabled?: boolean;
        /** Pi Pocket could not load it. */
        error?: string;
    };
    /** The adapter's folder is there, installed outside the app (under another module name). */
    foreign: boolean;
    /** The newest commit on the adapter's main branch, once looked up. */
    latest?: { commit: string; version?: string };
    checkedAt?: number;
    updateAvailable: boolean;
    /** The step under way. */
    busy?: string;
    /** What went wrong last. */
    message?: string;
    /** Pi Pocket's drop-in folder on this computer. */
    folder: string;
    /** The adapter's page, and the command that installs it on another server. */
    page: string;
    command: string;
}

export type BillionContextAction = "install" | "update" | "uninstall" | "check" | "enable" | "disable" | "show-folder" | "open-page";

export interface DictationAction {
    type: "download" | "cancel" | "remove" | "use";
    id: string;
}

/** One value in config.json that was not valid and fell back to its default. */
export interface SettingsProblem {
    path: string;
    message: string;
}

/** What a check of an address found. */
export type ProbeResult =
    | { kind: "detected"; url: string; bridge: number; via: "info" | "manifest" }
    | { kind: "other"; url: string; status: number; message: string; canOpen: boolean }
    | { kind: "unreachable"; url: string; message: string }
    | { kind: "invalid"; url: string; message: string };

/** Why the config screen is open. */
export type ConfigReason =
    | { kind: "first-run" }
    | { kind: "user" }
    | { kind: "not-detected"; probe: ProbeResult }
    | { kind: "load-failed"; url: string; message: string }
    | { kind: "outage"; url: string; message: string }
    | { kind: "crashed"; message: string }
    /** Pi Pocket on this computer is not running yet, or stopped: the screen shows its state. */
    | { kind: "local" };

/** Where this computer's Pi Pocket stands. */
export type LocalStatus =
    /** Not installed yet. */
    | "absent"
    | "installing"
    | "stopped"
    | "starting"
    | "running"
    /** A Pi Pocket the app did not start answers at the port (one started in a terminal): the app opens that one. */
    | "external"
    | "stopping"
    | "failed";

/** The app's own check for newer Pi Pocket and Node.js versions. */
export interface LocalUpdate {
    status: "idle" | "checking" | "current" | "building" | "ready" | "error";
    /** The versions found (checking, building) or built and waiting for a restart (ready). */
    pocket?: string;
    node?: string;
    message?: string;
    percent?: number;
    checkedAt?: number;
}

export interface LocalState {
    status: LocalStatus;
    /** What is happening, or what went wrong, in words. */
    message?: string;
    /** While installing: the step, and how far a download is. */
    progress?: { step: string; percent?: number };
    /** The versions in use. */
    installed?: { pocket: string; node: string };
    /** The address it is open at, while it runs. */
    url?: string;
    /** The launcher's last lines, without login tokens. */
    log: string[];
    /** Settings changed since it started: they take a restart of it. */
    restartNeeded: boolean;
    update: LocalUpdate;
    /** What an empty folder setting means here. */
    defaults: { folder: string; data: string };
    /** Where the app keeps the runtimes and the log. */
    home: string;
}

/** Where the app's own update stands (src/main/updates.ts). */
export interface UpdateState {
    /** How an update reaches this copy: installed by the app, a disk image to drag over, the release page, or git. */
    method: "install" | "download" | "page" | "source";
    status: "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";
    /** The newer version, once one is found. */
    version?: string;
    /** 0 to 100 while downloading. */
    percent?: number;
    message?: string;
    /** When the last check ended (ms since the epoch). */
    checkedAt?: number;
}

/** What the config page shows. */
export interface ConfigState {
    update: UpdateState;
    settings: Settings;
    defaults: Settings;
    problems: SettingsProblem[];
    configPath: string;
    reason: ConfigReason;
    /** The last check of the configured address, once there is one. */
    probe?: ProbeResult;
    /** When the next automatic try is, while the server cannot be reached (ms since the epoch). */
    nextRetryAt?: number;
    /** The address Pi Pocket is open at in the app, while it is (the server's page loaded or loading). */
    connectedUrl?: string;
    /** The server was open before the config screen: the page offers to go back. */
    canReturn: boolean;
    /** Show the app-owned way back while an unverified webpage (such as a sign-in gateway) is open. */
    recovery: boolean;
    /** The desktop has a tray. Without one, close minimizes. */
    trayAvailable: boolean;
    translucency: TranslucencySupport;
    /** Linux: the window was made see-through at start (turning it on takes a restart; off works at once). */
    translucentAtStart: boolean;
    /** The title bar the window was made with: a change takes a restart. */
    titleBarAtStart: TitleBarStyle;
    /** Pi Pocket's colors, the last the server's page showed (or the default before any). */
    theme: ThemeColors;
    platform: string;
    appVersion: string;
    local: LocalState;
    dictation: DictationState;
    billionContext: BillionContextState;
    runner: RunnerState;
}

/** What the config page can ask of this computer's Pi Pocket. */
export type LocalAction =
    | "install"
    | "start"
    | "stop"
    | "restart"
    | "open"
    | "check-updates"
    | "show-log"
    | "use-local"
    | "use-remote"
    | "uninstall";

/** A pinned session's state, as the square in Pi Pocket's session list shows it (`data-state`). */
export type PinState = "waiting" | "limited" | "working" | "failed" | "fresh" | "seen";

/** One pinned session, for the tray menu. */
export interface PinnedSession {
    id: number;
    title: string;
    state: PinState;
    /** The state in words. */
    label: string;
    /** The path to open on the server, such as "/s/12". */
    url: string;
}

/** A notification the server sent this app's page (docs/desktop.md in Pi Pocket). */
export interface HostNotification {
    title: string;
    body: string;
    /** The path a click opens: "/s/12", "/?pip=1", or "/". */
    url: string;
    /** One notification per tag: a newer one replaces it. */
    tag: string;
    urgency: "normal" | "high";
    approval?: {
        id: string;
        /** The whole call, never cut. */
        call: string;
        /** The person may allow it. */
        may: boolean;
        /** Web Push's rule: may, and the call fits on one short line. */
        allow: boolean;
    };
}

/** An event the app sends the server's page (`pocketHost.subscribe`). */
export type HostEvent =
    | { type: "visibility"; visible: boolean }
    | { type: "open"; url: string }
    | { type: "approve"; id: string; allow: boolean };

/** Pi Pocket's theme tokens the app takes (src/main/theme.ts). */
/** How the window's top looks: Pi Pocket up to the edge, or the system's own title bar. */
export type TitleBarStyle = "seamless" | "system";

export type ThemeToken =
    | "desk"
    | "bg"
    | "card"
    | "text"
    | "body"
    | "muted"
    | "accent"
    | "accent-fill"
    | "accent-ink"
    | "brand"
    | "ok"
    | "warn"
    | "err"
    | "code-bg";

/** Pi Pocket's colors as its page shows them: each token as #rrggbb (or #rrggbbaa), and dark or light. */
export interface ThemeColors {
    mode: "dark" | "light";
    colors: Record<ThemeToken, string>;
}

/** What the server page's preload learns when it starts: whether it may offer the bridge, and the window's state. */
export interface HostHello {
    visible: boolean;
    /** Offline dictation can run here: the page's mic button uses it (src/main/dictation.ts). */
    dictation: boolean;
    /** This computer's name, for "Link this computer" (the bridge's `runner` capability). */
    computerName: string;
}

/** What the config page can ask of the main process. */
export interface GuiConfigApi {
    state(): Promise<ConfigState>;
    probe(url: string): Promise<ProbeResult>;
    /** Saves the settings, and returns the stored (checked) state. */
    save(settings: Settings): Promise<ConfigState>;
    /** Checks before saving/opening. An unverified HTML page needs explicit permission; API/error pages never open. */
    connect(url: string, allowUnverified?: boolean): Promise<ProbeResult>;
    openSettings(): Promise<void>;
    /** Goes back to the server without changing anything. */
    back(): Promise<void>;
    retryNow(): Promise<void>;
    openExternal(target: "github" | "docs" | "releases"): Promise<void>;
    showConfigFile(): Promise<void>;
    checkUpdates(): Promise<void>;
    /** The next step of an update found: download it, install it, or open its page. */
    updateAction(): Promise<void>;
    /** Quits and starts the app again (a setting that needs a new window). */
    relaunch(): Promise<void>;
    local(action: LocalAction): Promise<void>;
    /** A folder picked in the system's dialog, or undefined when cancelled. */
    chooseFolder(start: string): Promise<string | undefined>;
    dictation(action: DictationAction): Promise<void>;
    showDictationFolder(): Promise<void>;
    billionContext(action: BillionContextAction): Promise<void>;
    runner(action: RunnerAction): Promise<void>;
    /** The main process asks to show a section of the settings, such as "dictation". */
    onFocus(listener: (section: string) => void): () => void;
    onState(listener: (state: ConfigState) => void): () => void;
}
