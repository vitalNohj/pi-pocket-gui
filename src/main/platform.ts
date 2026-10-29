/** What differs between desktops: whether there is a tray, and starting at login on Linux (Electron covers macOS and Windows). */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";

/**
 * Electron's tray on Linux is a StatusNotifierItem: it shows only where a StatusNotifierWatcher runs (KDE, Xfce,
 * Cinnamon, Ubuntu's GNOME with AppIndicator). Plain GNOME has none, and the icon would vanish without an error.
 */
export function trayAvailable(): Promise<boolean> {
    if (process.platform !== "linux") {
        return Promise.resolve(true);
    }

    return new Promise((done) => {
        execFile(
            "dbus-send",
            [
                "--session",
                "--print-reply",
                "--dest=org.freedesktop.DBus",
                "/org/freedesktop/DBus",
                "org.freedesktop.DBus.NameHasOwner",
                "string:org.kde.StatusNotifierWatcher",
            ],
            { timeout: 2000 },
            (error, stdout) => {
                if (error !== null) {
                    // No dbus-send, or no session bus: say there is a tray rather than hide the window for good.
                    done((error as NodeJS.ErrnoException).code === "ENOENT");

                    return;
                }

                done(/boolean true/.test(stdout));
            },
        );
    });
}

const AUTOSTART_NAME = "pi-pocket-gui.desktop";

function autostartPath(): string {
    const config = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");

    return join(config, "autostart", AUTOSTART_NAME);
}

/** The command that starts this app: the AppImage itself when run as one, else the executable. */
function launchCommand(): string {
    const appImage = process.env.APPIMAGE;
    const executable = appImage !== undefined && appImage !== "" ? appImage : process.execPath;
    const args = app.isPackaged ? [] : [app.getAppPath()];

    return [executable, ...args, "--autostart"].map((part) => `"${part.replace(/(["\\`$])/g, "\\$1")}"`).join(" ");
}

export function setLaunchAtLogin(enabled: boolean): void {
    if (process.platform !== "linux") {
        app.setLoginItemSettings({ openAtLogin: enabled, args: ["--autostart"] });

        return;
    }

    const path = autostartPath();

    if (!enabled) {
        rmSync(path, { force: true });

        return;
    }

    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(
        path,
        [
            "[Desktop Entry]",
            "Type=Application",
            "Name=Pi Pocket",
            "Comment=Desktop app for Pi Pocket",
            `Exec=${launchCommand()}`,
            "Icon=pi-pocket-gui",
            "Terminal=false",
            "X-GNOME-Autostart-enabled=true",
            "",
        ].join("\n"),
    );
}

/** Started by the login item: honor "start hidden". */
export function startedAtLogin(): boolean {
    return process.argv.includes("--autostart") || app.getLoginItemSettings().wasOpenedAtLogin === true;
}
