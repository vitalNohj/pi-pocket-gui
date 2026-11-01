/**
 * The app's settings: their defaults, the checks on what config.json holds, and reading and writing the file. A value
 * that is not valid falls back to its default and is reported, so a hand edit with a typo never stops the app.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Settings, SettingsProblem } from "../shared/types";
import { modelById } from "./dictation-catalog";
import { normalizeServerUrl } from "./url";

export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

export function defaultSettings(): Settings {
    return {
        server: { mode: "local", url: DEFAULT_SERVER_URL, extraOrigins: [] },
        connection: {
            autoConnect: true,
            probeTimeoutMs: 4000,
            retryMaxSeconds: 30,
            healthIntervalSeconds: 10,
            failuresBeforeOutage: 3,
        },
        window: {
            closeToTray: true,
            launchAtLogin: false,
            startHidden: false,
            showMenuBar: false,
            titleBar: "seamless",
            hotkeyEnabled: false,
            hotkey: "CommandOrControl+Shift+P",
            sameOriginLinks: "appWindow",
        },
        notifications: {
            enabled: true,
            sound: true,
            allowFromNotification: "whenFullyShown",
            maxCallLength: 120,
        },
        updates: { check: true, intervalHours: 6 },
        local: { folder: "", port: 8787, access: "local", data: "", keepUpdated: true },
        appearance: { translucent: false, opacity: 82, macMaterial: "under-window", windowsMaterial: "acrylic", trayMenu: "windows" },
        dictation: { model: "", live: true },
        billionContext: { autoUpdate: false },
    };
}

/** A check returns the value to store, or why the value is not valid. */
type Check<T> = (value: unknown) => { ok: true; value: T } | { ok: false; message: string };

const pass = <T>(value: T) => ({ ok: true as const, value });
const fail = (message: string) => ({ ok: false as const, message });

const bool: Check<boolean> = (value) => (typeof value === "boolean" ? pass(value) : fail("must be true or false"));

function int(min: number, max: number): Check<number> {
    return (value) =>
        typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
            ? pass(value)
            : fail(`must be a whole number from ${String(min)} to ${String(max)}`);
}

function oneOf<T extends string>(...options: T[]): Check<T> {
    return (value) =>
        typeof value === "string" && (options as string[]).includes(value)
            ? pass(value as T)
            : fail(`must be one of ${options.map((option) => `"${option}"`).join(", ")}`);
}

const serverUrl: Check<string> = (value) => {
    if (typeof value !== "string") {
        return fail("must be an address such as http://127.0.0.1:8787");
    }

    const normalized = normalizeServerUrl(value);

    return normalized.ok ? pass(normalized.url) : fail(normalized.message);
};

const origins: Check<string[]> = (value) => {
    if (!Array.isArray(value)) {
        return fail("must be a list of addresses");
    }

    const result: string[] = [];

    for (const each of value) {
        if (typeof each !== "string") {
            return fail("must be a list of addresses");
        }

        let url: URL;

        try {
            url = new URL(each);
        } catch {
            return fail(`${each}: not an address`);
        }

        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return fail(`${each}: only http and https addresses`);
        }

        result.push(url.origin);
    }

    return pass([...new Set(result)]);
};

const hotkey: Check<string> = (value) =>
    typeof value === "string" && /^[\w+]+$/.test(value) && value.length <= 64
        ? pass(value)
        : fail('must be a shortcut such as "CommandOrControl+Shift+P"');

/** A folder: empty for the default, else an absolute path. */
const path: Check<string> = (value) => {
    if (typeof value !== "string") {
        return fail("must be a folder's path");
    }

    const trimmed = value.trim();

    return trimmed === "" || isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("~")
        ? pass(trimmed)
        : fail("must be a full path, such as /home/you/code, or empty");
};

/** The check for each setting, in the shape of Settings. */
const schema: { [S in keyof Settings]: { [K in keyof Settings[S]]: Check<Settings[S][K]> } } = {
    server: { mode: oneOf("local", "remote"), url: serverUrl, extraOrigins: origins },
    connection: {
        autoConnect: bool,
        probeTimeoutMs: int(500, 60_000),
        retryMaxSeconds: int(2, 3600),
        healthIntervalSeconds: int(0, 3600),
        failuresBeforeOutage: int(1, 100),
    },
    window: {
        closeToTray: bool,
        launchAtLogin: bool,
        startHidden: bool,
        showMenuBar: bool,
        titleBar: oneOf("seamless", "system"),
        hotkeyEnabled: bool,
        hotkey,
        sameOriginLinks: oneOf("appWindow", "browser"),
    },
    notifications: {
        enabled: bool,
        sound: bool,
        allowFromNotification: oneOf("whenFullyShown", "always", "never"),
        maxCallLength: int(20, 2000),
    },
    updates: { check: bool, intervalHours: int(1, 24 * 30) },
    local: {
        folder: path,
        port: int(1024, 65535),
        access: oneOf("local", "lan", "tailscale", "cloudflare"),
        data: path,
        keepUpdated: bool,
    },
    appearance: {
        translucent: bool,
        opacity: int(0, 100),
        macMaterial: oneOf("under-window", "sidebar", "hud", "fullscreen-ui"),
        windowsMaterial: oneOf("acrylic", "mica"),
        trayMenu: oneOf("windows", "theme"),
    },
    dictation: {
        model: (value) => (value === "" || (typeof value === "string" && modelById(value) !== undefined) ? pass(value) : fail("must be a speech model's id")),
        live: bool,
    },
    billionContext: { autoUpdate: bool },
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Checks a parsed config.json. Missing values take their defaults quietly; wrong and unknown ones are reported. */
export function validateSettings(input: unknown): { settings: Settings; problems: SettingsProblem[] } {
    const settings = defaultSettings();
    const problems: SettingsProblem[] = [];

    if (input === undefined) {
        return { settings, problems };
    }

    if (!isRecord(input)) {
        return { settings, problems: [{ path: "(file)", message: "must be a JSON object" }] };
    }

    // Settings from before this computer could run Pi Pocket itself: they opened a server by its address.
    if (isRecord(input.server) && !("mode" in input.server)) {
        settings.server.mode = "remote";
    }

    for (const [section, value] of Object.entries(input)) {
        if (section === "$schema" || section === "version") {
            continue;
        }

        if (!(section in schema)) {
            problems.push({ path: section, message: "is not a setting" });
            continue;
        }

        if (!isRecord(value)) {
            problems.push({ path: section, message: "must be an object" });
            continue;
        }

        const checks = schema[section as keyof Settings] as Record<string, Check<unknown>>;
        const target = settings[section as keyof Settings] as Record<string, unknown>;

        for (const [key, raw] of Object.entries(value)) {
            const check = checks[key];

            if (check === undefined) {
                problems.push({ path: `${section}.${key}`, message: "is not a setting" });
                continue;
            }

            const checked = check(raw);

            if (checked.ok) {
                target[key] = checked.value;
            } else {
                problems.push({ path: `${section}.${key}`, message: checked.message });
            }
        }
    }

    return { settings, problems };
}

export interface LoadedSettings {
    settings: Settings;
    problems: SettingsProblem[];
}

export function loadSettings(path: string): LoadedSettings {
    let text: string;

    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return validateSettings(undefined);
        }

        return {
            settings: defaultSettings(),
            problems: [{ path: "(file)", message: `cannot be read: ${(error as Error).message}` }],
        };
    }

    try {
        return validateSettings(JSON.parse(text) as unknown);
    } catch (error) {
        return {
            settings: defaultSettings(),
            problems: [{ path: "(file)", message: `is not valid JSON: ${(error as Error).message}` }],
        };
    }
}

/** Writes the settings whole, through a temporary file, so a crash never leaves half a file. */
export function saveSettings(path: string, settings: Settings): void {
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${String(process.pid)}.tmp`;

    writeFileSync(temporary, `${JSON.stringify({ version: 1, ...settings }, null, 4)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
}
