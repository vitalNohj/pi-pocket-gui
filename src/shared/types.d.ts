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

/** Whether this desktop can make the window see-through now, and what it blurs with. */
export type TranslucencySupport =
    | { kind: "live"; blur: "system" | "compositor" }
    /** Linux: a window is see-through only when made so, so turning it on needs a restart. */
    | { kind: "restart" }
    | { kind: "unsupported"; message: string };

/** Every setting, as stored in config.json. */
export interface Settings {
    server: {
        /** The server's address: scheme, host, port, and an optional path. */
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
    appearance: {
        /** A see-through window, blurred where the desktop can: the page's grounds let the desktop show. */
        translucent: boolean;
        /** How solid the page's grounds stay, in percent: 100 hides the desktop, 40 shows it most. */
        opacity: number;
        macMaterial: MacMaterial;
        windowsMaterial: WindowsMaterial;
    };
}

/** One value in config.json that was not valid and fell back to its default. */
export interface SettingsProblem {
    path: string;
    message: string;
}

/** What a check of an address found. */
export type ProbeResult =
    | { kind: "detected"; url: string; bridge: number; via: "info" | "manifest" }
    | { kind: "other"; url: string; status: number; message: string }
    | { kind: "unreachable"; url: string; message: string }
    | { kind: "invalid"; url: string; message: string };

/** Why the config screen is open. */
export type ConfigReason =
    | { kind: "first-run" }
    | { kind: "user" }
    | { kind: "not-detected"; probe: ProbeResult }
    | { kind: "load-failed"; url: string; message: string }
    | { kind: "outage"; url: string; message: string }
    | { kind: "crashed"; message: string };

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
    /** The server was open before the config screen: the page offers to go back. */
    canReturn: boolean;
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
}

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
}

/** What the config page can ask of the main process. */
export interface GuiConfigApi {
    state(): Promise<ConfigState>;
    probe(url: string): Promise<ProbeResult>;
    /** Saves the settings, and returns the stored (checked) state. */
    save(settings: Settings): Promise<ConfigState>;
    /** Saves the address and opens the server. */
    connect(url: string): Promise<void>;
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
    onState(listener: (state: ConfigState) => void): () => void;
}
