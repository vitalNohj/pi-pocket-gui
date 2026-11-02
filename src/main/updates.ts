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
 *
 * Each action (the Updates card's button, the tray item, the notification) first asks for the newest release again,
 * so it never downloads, opens, or installs a version that a newer release replaced after the last check. When that
 * check fails, the action does nothing and the card says so (`nextUpdateStep` in update-pick.ts decides).
 */
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, net, Notification, shell, type BaseWindow } from "electron";
import type { Settings, UpdateState } from "../shared/types";
import { downloadChecked } from "./download";
import {
    CheckGenerations,
    isNewer,
    macImage,
    nextUpdateStep,
    readRelease,
    recheckFailedMessage,
    sha256Of,
    singleFlight,
    updateMethod,
    whenDownloaded,
    withTimeout,
    type Release,
    type UpdateMethod,
} from "./update-pick";

const REPO = "vitalNohj/pi-pocket-gui";
const LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES = `https://github.com/${REPO}/releases`;
/** The first check waits a little after start, so it never slows the window down. */
const FIRST_CHECK_MS = 15_000;
/** How long the check before an action may take: the person waits for it, so it fails rather than hangs. */
const RECHECK_MS = 10_000;

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
    /**
     * The next step for an update found: download, install, or open its page. It checks the newest release first, so it
     * never acts on a release that a newer one replaced since the last check. A call while one runs does nothing more.
     */
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
    /** download: the disk image downloaded and checked, and its version. */
    let downloaded: { version: string; path: string } | undefined;
    /** install: the version electron-updater has downloaded, ready to install on restart. */
    let readyVersion: string | undefined;
    /** install: an action of the update button runs; it asks to restart itself, once the newest version is here. */
    let acting = false;
    /** install: a late result of a check that an action gave up on must not install or ask to restart. */
    const generations = new CheckGenerations();
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
            // The version already downloaded is still the newest: electron-updater only finds its file again.
            if (info.version !== readyVersion) {
                // A newer one replaces it: the older download must not install when the app quits meanwhile.
                readyVersion = undefined;
                autoUpdater.autoInstallOnAppQuit = false;
            }

            // A late result of an abandoned check: the card keeps saying that the check failed.
            if (!generations.live()) {
                return;
            }

            if (info.version !== readyVersion) {
                set({ status: "downloading", version: info.version, percent: 0 });
            }

            notifyAvailable(info.version);
        });
        autoUpdater.on("update-not-available", () => {
            // A release newer than this app is gone (it was pulled): its download must not install when the app quits.
            readyVersion = undefined;
            autoUpdater.autoInstallOnAppQuit = false;

            if (generations.live()) {
                set({ status: "current", checkedAt: Date.now() });
            }
        });
        autoUpdater.on("download-progress", (progress) => {
            if (generations.live()) {
                set({ status: "downloading", percent: Math.floor(progress.percent) });
            }
        });
        autoUpdater.on("update-downloaded", (info) => {
            const next = whenDownloaded({ live: generations.live(), fresh: info.version !== readyVersion, acting });

            // Abandoned: the file stays in electron-updater's cache, unused. The next check finds it again and owns it.
            if (!next.installOnQuit) {
                return;
            }

            readyVersion = info.version;
            autoUpdater.autoInstallOnAppQuit = true;
            set({ status: "ready", version: info.version, checkedAt: Date.now() });

            if (next.ask) {
                void askToRestart(info.version);
            }
        });
        autoUpdater.on("error", (error) => {
            if (generations.live()) {
                set({ status: "error", message: error.message, checkedAt: Date.now() });
            }
        });
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

        // A newer version may have replaced this one while the question was open: never install the older one.
        if (response === 0 && readyVersion === version) {
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

        // A check while the question was open can have dropped the image for a newer release: never open it then.
        if (response === 0 && downloaded?.path === image) {
            await openAndQuit(image);
        }
    };

    /** GitHub's latest release now, or undefined when there is none. Throws when GitHub cannot be asked. */
    const latestRelease = async (): Promise<Release | undefined> => {
        const response = await net.fetch(LATEST, {
            headers: { accept: "application/vnd.github+json", "user-agent": `pi-pocket-gui/${app.getVersion()}` },
            cache: "no-store",
        });

        if (response.status === 404) {
            return undefined;
        }

        if (!response.ok) {
            throw new Error(`GitHub answered HTTP ${response.status}.`);
        }

        return readRelease(await response.json());
    };

    /** Forgets the downloaded disk image and removes it: it is not the newest release, so it must never open. */
    const dropImage = async (): Promise<void> => {
        const old = downloaded;

        downloaded = undefined;

        if (old !== undefined) {
            await rm(old.path, { force: true }).catch(() => undefined);
        }
    };

    const checkRelease = async (): Promise<void> => {
        const found = await latestRelease();

        if (found === undefined || !isNewer(found.version, app.getVersion())) {
            release = undefined;
            await dropImage();
            set({ status: "current", checkedAt: Date.now() });

            return;
        }

        if (downloaded !== undefined && downloaded.version !== found.version) {
            await dropImage();
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

        set({ status: "checking" });

        try {
            if (method === "install") {
                const autoUpdater = await setUpUpdater();

                generations.begin();
                await autoUpdater.checkForUpdates();
            } else {
                await checkRelease();
            }
        } catch (error) {
            set({ status: "error", message: (error as Error).message, checkedAt: Date.now() });
        }
    };

    /** Downloads the disk image of `latest` for this Mac, then offers to open it. */
    const downloadImage = async (latest: Release): Promise<void> => {
        const image = macImage(latest, process.arch);

        if (image === undefined) {
            set({ status: "available" });
            void shell.openExternal(latest.page);

            return;
        }

        set({ status: "downloading", percent: 0 });

        try {
            const sha256 = sha256Of(image);
            const path = await downloadChecked({
                url: image.url,
                name: image.name,
                folder: app.getPath("downloads"),
                ...(sha256 === undefined ? {} : { sha256 }),
                size: image.size,
                fetch: (url) => net.fetch(url),
                onProgress: (percent) => set({ percent }),
            });

            downloaded = { version: latest.version, path };
            set({ status: "ready", percent: 100 });
            await askToOpen(latest.version, path);
        } catch (error) {
            set({ status: "error", message: (error as Error).message });
        }
    };

    /**
     * install: electron-updater checks again. When a newer version is out, it downloads that one (and drops the older
     * download); when the downloaded one is still the newest, it only finds it again. Then the app asks to restart.
     */
    const actInstall = async (): Promise<void> => {
        const known = state.version;
        const autoUpdater = await setUpUpdater();

        set({ status: "checking" });

        let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>>;
        const token = generations.begin();

        try {
            result = await withTimeout(autoUpdater.checkForUpdates(), RECHECK_MS, "The check for a newer version");
        } catch (error) {
            // The check goes on in electron-updater: its late result must not install or ask.
            generations.abandon(token);
            set({ status: "error", message: recheckFailedMessage((error as Error).message, known), checkedAt: Date.now() });

            return;
        }

        const latest = result?.isUpdateAvailable === true ? result.updateInfo.version : undefined;
        const step = nextUpdateStep({
            method: "install",
            running: app.getVersion(),
            ...(known === undefined ? {} : { known }),
            ...(readyVersion === undefined ? {} : { downloaded: readyVersion }),
            latest,
        });

        if (step.kind === "current" || latest === undefined) {
            set({ status: "current", checkedAt: Date.now() });

            return;
        }

        try {
            await result?.downloadPromise;
        } catch {
            // The error event shows it on the card.
            return;
        }

        if (readyVersion === latest) {
            await askToRestart(latest);
        }
    };

    /** download and page: GitHub's latest release, asked again now. */
    const actRelease = async (current: "download" | "page"): Promise<void> => {
        const known = state.version ?? release?.version;

        set({ status: "checking" });

        let latest: Release | undefined | Error;

        try {
            latest = await withTimeout(latestRelease(), RECHECK_MS, "The check for a newer version");
        } catch (error) {
            latest = error as Error;
        }

        const step = nextUpdateStep({
            method: current,
            running: app.getVersion(),
            ...(known === undefined ? {} : { known }),
            ...(downloaded === undefined ? {} : { downloaded: downloaded.version }),
            latest: latest instanceof Error ? latest : latest?.version,
        });

        if (step.kind === "failed") {
            set({ status: "error", message: step.message, checkedAt: Date.now() });

            return;
        }

        if (step.kind === "current" || latest === undefined || latest instanceof Error) {
            release = undefined;
            await dropImage();
            set({ status: "current", checkedAt: Date.now() });

            return;
        }

        release = latest;
        // "downloading" at once: a check or a click in between must not start a second download.
        set({
            status: step.kind === "open-image" ? "ready" : step.kind === "download" ? "downloading" : "available",
            version: latest.version,
            percent: 0,
            checkedAt: Date.now(),
        });
        notifyAvailable(latest.version);

        switch (step.kind) {
            case "open-page":
                void shell.openExternal(latest.page);
                break;
            case "open-image":
                if (downloaded !== undefined) {
                    await openAndQuit(downloaded.path);
                }

                break;
            case "download":
                await dropImage();
                await downloadImage(latest);
                break;
            default:
                break;
        }
    };

    const act = singleFlight(async (): Promise<void> => {
        if (state.status === "checking" || state.status === "downloading") {
            return;
        }

        if (method === "source") {
            await check(true);
        } else if (method === "install") {
            acting = true;

            try {
                await actInstall();
            } finally {
                acting = false;
            }
        } else {
            await actRelease(method);
        }
    });

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
