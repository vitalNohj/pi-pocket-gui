/**
 * The app's own updates, from this repository's GitHub releases. Pi Pocket itself updates on its server.
 *
 * How an update arrives depends on how this copy can take one (`updateMethod`):
 * - install: electron-updater downloads it and installs it when the app restarts (Windows, a Linux AppImage, and a
 *   macOS app signed by an Apple team). The app asks before it restarts.
 * - download: macOS without a team signature, which Squirrel.Mac refuses to update. The app downloads the disk image
 *   for this Mac, checks it against GitHub's checksum, opens it, and quits: macOS cannot replace a running app, so the
 *   person drags the new one over the old one only once this one is gone.
 * - page: a Linux .deb opens the release page. source: a checkout run with `npm start` says to `git pull`.
 */
import { execFile } from "node:child_process";
import { join } from "node:path";
import { app, dialog, net, Notification, shell, type BaseWindow } from "electron";
import type { Settings, UpdateState } from "../shared/types";
import { downloadChecked } from "./download";
import { isNewer, macImage, readRelease, sha256Of, updateMethod, type Release, type UpdateMethod } from "./update-pick";

const REPO = "vitalNohj/pi-pocket-gui";
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases`;
/** The first check waits a little after start, so it never slows the window down. */
const FIRST_CHECK_MS = 15_000;

export interface UpdateHost {
    assets: string;
    window: () => BaseWindow;
    settings: () => Settings;
    /** The state changed: the config screen and the tray show it again. */
    changed: () => void;
    /** Before the app quits to install: closing must not hide it in the tray. */
    quitting: () => void;
}

/** How long a quit to install may take before the app exits anyway: nothing may keep it running over the update. */
const QUIT_LIMIT_MS = 5_000;

/** Whether this macOS app is signed by an Apple team (not ad hoc), which Squirrel.Mac needs to update it. */
function teamSigned(): Promise<boolean> {
    if (process.platform !== "darwin" || !app.isPackaged) {
        return Promise.resolve(false);
    }

    // …/Pi Pocket.app/Contents/MacOS/pi-pocket-gui → …/Pi Pocket.app
    const bundle = join(process.execPath, "..", "..", "..");

    return new Promise((done) => {
        execFile("codesign", ["-dv", bundle], { timeout: 5000 }, (_error, _stdout, stderr) => {
            const team = /^TeamIdentifier=(.+)$/m.exec(String(stderr))?.[1]?.trim();

            done(team !== undefined && team !== "" && team !== "not set");
        });
    });
}

export function setUpUpdates(host: UpdateHost): {
    state: () => UpdateState;
    check: (manual: boolean) => Promise<void>;
    /** The next step for an update found: download, install, or open its page. */
    act: () => Promise<void>;
    /** The settings changed: the timer follows them. */
    reschedule: () => void;
    /** A line for the tray menu, when there is something to do. */
    trayItem: () => { label: string; click: () => void } | undefined;
} {
    let method: UpdateMethod = updateMethod(process.platform, {
        packaged: app.isPackaged,
        appImage: Boolean(process.env.APPIMAGE),
        teamSigned: false,
    });
    let state: UpdateState = { method, status: "idle" };
    let release: Release | undefined;
    let downloaded: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    let told: string | undefined;
    // Loaded only where it installs: elsewhere it is never needed, and on macOS it would find no update it can use.
    let updater: typeof import("electron-updater").autoUpdater | undefined;

    const set = (next: Partial<UpdateState>): void => {
        state = { ...state, ...next, method };
        host.changed();
    };

    const notifyAvailable = (version: string): void => {
        if (told === version || !Notification.isSupported()) {
            return;
        }

        told = version;

        const notice = new Notification({
            title: `Pi Pocket ${version} is available`,
            body:
                method === "install"
                    ? "It downloads now and installs when the app restarts."
                    : method === "download"
                      ? "Click to download it. Then drag the app into Applications, over the old one."
                      : "Click to open the release.",
            icon: join(host.assets, "icon-192.png"),
            silent: true,
        });

        notice.on("click", () => void act());
        notice.show();
    };

    const setUpUpdater = async (): Promise<NonNullable<typeof updater>> => {
        if (updater !== undefined) {
            return updater;
        }

        const { autoUpdater } = await import("electron-updater");

        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = false;
        autoUpdater.logger = null;
        autoUpdater.on("update-available", (info) => {
            set({ status: "downloading", version: info.version, percent: 0 });
            notifyAvailable(info.version);
        });
        autoUpdater.on("update-not-available", () => set({ status: "current", checkedAt: Date.now() }));
        autoUpdater.on("download-progress", (progress) => set({ status: "downloading", percent: Math.floor(progress.percent) }));
        autoUpdater.on("update-downloaded", (info) => {
            set({ status: "ready", version: info.version, checkedAt: Date.now() });
            void askToRestart(info.version);
        });
        autoUpdater.on("error", (error) => set({ status: "error", message: error.message, checkedAt: Date.now() }));
        updater = autoUpdater;

        return autoUpdater;
    };

    const askToRestart = async (version: string): Promise<void> => {
        const { response } = await dialog.showMessageBox(host.window(), {
            type: "info",
            title: "Pi Pocket",
            message: `Pi Pocket ${version} is ready.`,
            detail: "Restart now to use it, or it installs the next time the app quits.",
            buttons: ["Restart now", "Later"],
            defaultId: 0,
            cancelId: 1,
        });

        if (response === 0) {
            host.quitting();
            updater?.quitAndInstall();
        }
    };

    /**
     * Opens the disk image, then quits: the app in Applications cannot be replaced while it runs. When macOS cannot open
     * the image, it shows it in Finder instead and the app stays.
     */
    const openAndQuit = async (image: string): Promise<void> => {
        const failed = await shell.openPath(image);

        if (failed !== "") {
            shell.showItemInFolder(image);
            void dialog.showMessageBox(host.window(), {
                type: "warning",
                title: "Pi Pocket",
                message: "The disk image did not open.",
                detail: `${failed} It is shown in Finder: quit Pi Pocket, open the image, and drag Pi Pocket into Applications over the old one.`,
                buttons: ["OK"],
            });

            return;
        }

        host.quitting();
        app.quit();
        // A window or a handler that holds the quit must not keep the old app running under the person's drag.
        setTimeout(() => app.exit(0), QUIT_LIMIT_MS).unref();
    };

    /** The disk image is here: quit and open it now, or later from the Updates card or the tray. */
    const askToOpen = async (version: string, image: string): Promise<void> => {
        const { response } = await dialog.showMessageBox(host.window(), {
            type: "info",
            title: "Pi Pocket",
            message: `Pi Pocket ${version} is downloaded.`,
            detail: "Pi Pocket quits and opens the disk image. Drag Pi Pocket into Applications over the old one, then open it again. Your settings and sign-in stay.",
            buttons: ["Quit and open", "Later"],
            defaultId: 0,
            cancelId: 1,
        });

        if (response === 0) {
            await openAndQuit(image);
        }
    };

    const checkRelease = async (): Promise<void> => {
        const response = await net.fetch(LATEST, {
            headers: { accept: "application/vnd.github+json", "user-agent": `pi-pocket-gui/${app.getVersion()}` },
        });

        if (response.status === 404) {
            set({ status: "current", checkedAt: Date.now() });

            return;
        }

        if (!response.ok) {
            throw new Error(`GitHub answered HTTP ${response.status}.`);
        }

        const found = readRelease(await response.json());

        if (found === undefined || !isNewer(found.version, app.getVersion())) {
            set({ status: "current", checkedAt: Date.now() });

            return;
        }

        if (release?.version !== found.version) {
            downloaded = undefined;
        }

        release = found;
        set({ status: downloaded === undefined ? "available" : "ready", version: found.version, checkedAt: Date.now() });
        notifyAvailable(found.version);
    };

    const check = async (manual: boolean): Promise<void> => {
        if (state.status === "checking" || state.status === "downloading") {
            return;
        }

        if (!manual && !host.settings().updates.check) {
            return;
        }

        if (method === "source") {
            set({ status: "current", message: "Run from source: git pull updates it.", checkedAt: Date.now() });

            return;
        }

        if (method === "install" && state.status === "ready") {
            return;
        }

        set({ status: "checking" });

        try {
            if (method === "install") {
                await (await setUpUpdater()).checkForUpdates();
            } else {
                await checkRelease();
            }
        } catch (error) {
            set({ status: "error", message: (error as Error).message, checkedAt: Date.now() });
        }
    };

    const act = async (): Promise<void> => {
        if (method === "install") {
            if (state.status === "ready" && state.version !== undefined) {
                await askToRestart(state.version);
            } else {
                await check(true);
            }

            return;
        }

        if (release === undefined) {
            await check(true);

            return;
        }

        if (method === "page") {
            void shell.openExternal(release.page);

            return;
        }

        // download: the disk image for this Mac.
        if (downloaded !== undefined) {
            await openAndQuit(downloaded);

            return;
        }

        const image = macImage(release, process.arch);

        if (image === undefined) {
            void shell.openExternal(release.page);

            return;
        }

        set({ status: "downloading", percent: 0 });

        try {
            const sha256 = sha256Of(image);

            downloaded = await downloadChecked({
                url: image.url,
                name: image.name,
                folder: app.getPath("downloads"),
                ...(sha256 === undefined ? {} : { sha256 }),
                size: image.size,
                fetch: (url) => net.fetch(url),
                onProgress: (percent) => set({ percent }),
            });
            set({ status: "ready", percent: 100 });
            await askToOpen(release.version, downloaded);
        } catch (error) {
            set({ status: "error", message: (error as Error).message });
        }
    };

    const reschedule = (): void => {
        if (timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }

        const settings = host.settings().updates;

        if (settings.check && method !== "source") {
            timer = setInterval(() => void check(false), settings.intervalHours * 3_600_000);
        }
    };

    void teamSigned().then((signed) => {
        method = updateMethod(process.platform, {
            packaged: app.isPackaged,
            appImage: Boolean(process.env.APPIMAGE),
            teamSigned: signed,
        });
        state = { ...state, method };
        host.changed();
        reschedule();
        setTimeout(() => void check(false), FIRST_CHECK_MS);
    });

    return {
        state: () => state,
        check,
        act,
        reschedule,
        trayItem: () => {
            if (state.version === undefined || (state.status !== "available" && state.status !== "ready")) {
                return undefined;
            }

            const label =
                state.status === "ready" && method === "install"
                    ? `Restart to update to ${state.version}`
                    : state.status === "ready" && method === "download"
                      ? `Quit and install Pi Pocket ${state.version}…`
                      : method === "download"
                        ? `Download Pi Pocket ${state.version}…`
                        : `Pi Pocket ${state.version} is available…`;

            return { label, click: () => void act() };
        },
    };
}

export { RELEASES };
