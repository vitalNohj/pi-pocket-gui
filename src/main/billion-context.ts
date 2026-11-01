/**
 * billion-context-pi in this computer's Pi Pocket: the app installs the Pi Pocket adapter for it
 * (vitalNohj/billion-context-pi-pocket-adapter) as a drop-in extension, turns it on, keeps it up to date, and removes
 * it. Only for the Pi Pocket the app runs itself: another server shows how to install it there.
 *
 * The files come from the newest commit of the adapter's main branch, each checked against the git hash GitHub lists
 * for it. Pi Pocket itself is not changed: the files go in its drop-in folder (`<data>/extensions`), and the extension
 * is turned on and off through Pi Pocket's own API, signed in with its owner token.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BillionContextState, Settings } from "../shared/types";
import { downloadChecked } from "./download";

export const ADAPTER = {
    repo: "vitalNohj/billion-context-pi-pocket-adapter",
    branch: "main",
    /** The module Pi Pocket loads. */
    file: "billion-context-pi-pocket-adapter.ts",
    /** Its folder: billion-context-pi itself and its dependencies, found by this name next to the module. */
    folder: "billion-context-pi-pocket-adapter",
} as const;

export const ADAPTER_PAGE = `https://github.com/${ADAPTER.repo}`;

/** Installs (and updates) on a Linux or macOS server, run in its drop-in folder. */
export const REMOTE_COMMAND =
    `cd ~/.pi-pocket/extensions && rm -rf ${ADAPTER.folder} && ` +
    `curl -fsSL https://codeload.github.com/${ADAPTER.repo}/tar.gz/${ADAPTER.branch} | ` +
    `tar -xz --strip-components=1 ${ADAPTER.folder}-${ADAPTER.branch}/${ADAPTER.file} ${ADAPTER.folder}-${ADAPTER.branch}/${ADAPTER.folder}`;

/** In the adapter's folder: which commit the app installed. Its absence means someone else installed the files. */
const MARKER = ".pi-pocket-gui.json";

export interface TreeEntry {
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
}

/** The files the adapter is made of, out of a commit's tree: the module and everything in its folder. */
export function adapterFiles(tree: readonly TreeEntry[]): TreeEntry[] {
    const files = tree.filter((entry) => entry.type === "blob" && (entry.path === ADAPTER.file || entry.path.startsWith(`${ADAPTER.folder}/`)));

    if (!files.some((entry) => entry.path === ADAPTER.file) || !files.some((entry) => entry.path === `${ADAPTER.folder}/bundle.json`)) {
        throw new Error("The adapter's repository does not hold the adapter's files at that commit.");
    }

    for (const entry of files) {
        if ((entry.mode !== "100644" && entry.mode !== "100755") || entry.path.split("/").some((part) => part === ".." || part === "")) {
            throw new Error(`${entry.path} in the adapter's repository is not a plain file.`);
        }
    }

    return files;
}

/** Git's hash of a file's content (a blob): what the commit's tree lists for it. */
export function blobSha(data: Buffer): string {
    return createHash("sha1").update(`blob ${String(data.length)}\0`).update(data).digest("hex");
}

export interface BillionContextHost {
    /** The app's own folder for downloads while installing. */
    home: string;
    platform: NodeJS.Platform;
    settings: () => Settings;
    /** Pi Pocket's data folder on this computer: its drop-in folder and its owner token are in it. */
    dataFolder: () => string;
    /** This computer's Pi Pocket, as the app runs it: its address while it runs, and whether it is installed. */
    local: () => { installed: boolean; url: string | undefined };
    /** Requests to GitHub. */
    fetch: (url: string, headers?: Record<string, string>) => Promise<Response>;
    /** Requests to this computer's Pi Pocket. */
    request: (url: string, init: RequestInit) => Promise<Response>;
    changed: () => void;
}

interface Installed {
    /** billion-context-pi's version, from the folder's bundle.json. */
    version: string;
    /** The adapter's commit the app installed; undefined when the files came from elsewhere. */
    commit?: string;
}

interface ExtensionInfo {
    file: string;
    enabled: boolean;
    error?: string;
}

export function setUpBillionContext(host: BillionContextHost) {
    let busy: string | undefined;
    let message: string | undefined;
    let latest: { commit: string; version?: string } | undefined;
    let checkedAt: number | undefined;
    /** What Pi Pocket said about the extension, the last time it was asked. */
    let module: ExtensionInfo | undefined;
    let timer: NodeJS.Timeout | undefined;

    const folder = () => join(host.dataFolder(), "extensions");

    const installed = (): Installed | undefined => {
        const root = join(folder(), ADAPTER.folder);

        if (!existsSync(join(folder(), ADAPTER.file))) {
            return undefined;
        }

        let version = "?";

        try {
            version = (JSON.parse(readFileSync(join(root, "bundle.json"), "utf8")) as { version?: string }).version ?? "?";
        } catch {
            // The folder is missing or broken: Pi Pocket shows the adapter's error.
        }

        try {
            const marker = JSON.parse(readFileSync(join(root, MARKER), "utf8")) as { commit?: unknown };

            return typeof marker.commit === "string" ? { version, commit: marker.commit } : { version };
        } catch {
            return { version };
        }
    };

    /** The adapter's folder is there without the app's module: it was installed by hand, maybe by another name. */
    const foreign = (): boolean => existsSync(join(folder(), ADAPTER.folder)) && !existsSync(join(folder(), ADAPTER.file));

    const ownerToken = (): string => {
        try {
            const config = JSON.parse(readFileSync(join(host.dataFolder(), "config.json"), "utf8")) as { ownerToken?: unknown };

            if (typeof config.ownerToken === "string" && config.ownerToken !== "") {
                return config.ownerToken;
            }
        } catch {
            // Below.
        }

        throw new Error(`Pi Pocket's owner sign-in was not found in ${host.dataFolder()}.`);
    };

    /** Calls Pi Pocket's API as its owner. */
    const api = async (path: string, body?: unknown): Promise<unknown> => {
        const url = host.local().url;

        if (url === undefined) {
            throw new Error("Start Pi Pocket first.");
        }

        const response = await host.request(`${url}${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                authorization: `Bearer ${ownerToken()}`,
                "x-pocket": "1",
                ...(body === undefined ? {} : { "content-type": "application/json" }),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const answer = (await response.json().catch(() => undefined)) as { error?: string } | undefined;

        if (!response.ok) {
            throw new Error(answer?.error ?? `Pi Pocket answered HTTP ${String(response.status)}.`);
        }

        return answer;
    };

    const remember = (answer: unknown): void => {
        const modules = (answer as { modules?: ExtensionInfo[] } | undefined)?.modules ?? [];

        module = modules.find((each) => each.file === ADAPTER.file);
    };

    /** Turns the extension on or off in Pi Pocket; on, a load error comes back as the request's error. */
    const setEnabled = async (enabled: boolean): Promise<void> => {
        try {
            remember(await api(`/api/extensions/${encodeURIComponent(ADAPTER.file)}`, { enabled }));
        } finally {
            await ask().catch(() => {});
        }
    };

    /** Asks Pi Pocket whether the extension is on. */
    const ask = async (): Promise<void> => {
        if (host.local().url === undefined) {
            module = undefined;

            return;
        }

        remember(await api("/api/extensions"));
    };

    const github = async (path: string, accept = "application/vnd.github+json"): Promise<Response> => {
        const response = await host.fetch(`https://api.github.com/repos/${ADAPTER.repo}${path}`, { accept });

        if (!response.ok) {
            throw new Error(
                response.status === 403 || response.status === 429
                    ? "GitHub is limiting requests from this network. Try again in an hour."
                    : `GitHub answered HTTP ${String(response.status)}.`,
            );
        }

        return response;
    };

    /** The newest commit on the adapter's branch, and billion-context-pi's version in it. */
    const check = async (): Promise<void> => {
        const commit = (await (await github(`/commits/${ADAPTER.branch}`, "application/vnd.github.sha")).text()).trim();

        if (!/^[0-9a-f]{40}$/.test(commit)) {
            throw new Error("GitHub did not name the adapter's newest commit.");
        }

        let version: string | undefined;

        try {
            const bundle = await host.fetch(`https://raw.githubusercontent.com/${ADAPTER.repo}/${commit}/${ADAPTER.folder}/bundle.json`);

            version = bundle.ok ? ((await bundle.json()) as { version?: string }).version : undefined;
        } catch {
            // The version is only shown.
        }

        latest = { commit, ...(version === undefined ? {} : { version }) };
        checkedAt = Date.now();
    };

    const run = (file: string, args: string[]): Promise<void> =>
        new Promise((done, fail) => {
            execFile(file, args, { windowsHide: true }, (error, _stdout, stderr) => {
                if (error === null) {
                    done();
                } else {
                    fail(new Error(`${file} failed: ${stderr.trim() || error.message}`));
                }
            });
        });

    /** Downloads the commit's files, checks each against the commit's tree, and puts them in a folder of their own. */
    const fetchFiles = async (commit: string, into: string, step: (text: string) => void): Promise<void> => {
        step("Listing the adapter's files…");

        const tree = (await (await github(`/git/trees/${commit}?recursive=1`)).json()) as { tree?: TreeEntry[]; truncated?: boolean };

        if (tree.truncated === true || tree.tree === undefined) {
            throw new Error("GitHub did not list all of the adapter's files.");
        }

        const files = adapterFiles(tree.tree);
        const downloads = join(host.home, "downloads");
        const unpacked = join(host.home, `unpack-${commit}`);

        await rm(unpacked, { recursive: true, force: true });
        await mkdir(downloads, { recursive: true });
        await mkdir(unpacked, { recursive: true });

        try {
            step("Downloading…");

            const archive = await downloadChecked({
                url: `https://codeload.github.com/${ADAPTER.repo}/tar.gz/${commit}`,
                name: `billion-context-${commit}.tar.gz`,
                folder: downloads,
                fetch: (url) => host.fetch(url),
                onProgress: (percent) => step(`Downloading… ${String(percent)}%`),
            });

            step("Checking the files…");
            // Windows 10 and later have bsdtar.
            const tar = host.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

            await run(tar, ["-xzf", archive, "-C", unpacked, "--strip-components=1"]);
            await rm(archive, { force: true });

            for (const entry of files) {
                const from = join(unpacked, ...entry.path.split("/"));
                const data = await readFile(from).catch(() => undefined);

                if (data === undefined || blobSha(data) !== entry.sha) {
                    throw new Error(`${entry.path} does not match the adapter's commit, so nothing was installed.`);
                }

                const to = join(into, ...entry.path.split("/"));

                await mkdir(dirname(to), { recursive: true });
                await copyFile(from, to);
            }

            await writeFile(join(into, ADAPTER.folder, MARKER), `${JSON.stringify({ commit, installedAt: new Date().toISOString() }, null, 4)}\n`);
        } finally {
            await rm(unpacked, { recursive: true, force: true }).catch(() => {});
        }
    };

    /** Installs the newest commit, or replaces the installed one with it: off, files swapped, on again. */
    const put = async (step: (text: string) => void): Promise<void> => {
        if (host.local().url === undefined) {
            throw new Error("Start Pi Pocket first: the app turns the extension on through it.");
        }

        if (foreign()) {
            throw new Error(`The adapter's folder is already in ${folder()}, installed outside the app. Remove that copy first.`);
        }

        step("Looking for the newest version…");
        await check();

        const commit = latest!.commit;
        const was = installed();
        const staging = join(folder(), `_${ADAPTER.folder}.new`);
        const old = join(folder(), `_${ADAPTER.folder}.old`);

        await rm(staging, { recursive: true, force: true });
        await mkdir(staging, { recursive: true });

        try {
            await fetchFiles(commit, staging, step);
            step("Installing…");
            await ask();

            const wasOn = was !== undefined && module?.enabled === true;

            if (wasOn) {
                await setEnabled(false);
            }

            await rm(old, { recursive: true, force: true });

            if (existsSync(join(folder(), ADAPTER.folder))) {
                await rename(join(folder(), ADAPTER.folder), old);
            }

            await rename(join(staging, ADAPTER.folder), join(folder(), ADAPTER.folder));
            await rename(join(staging, ADAPTER.file), join(folder(), ADAPTER.file));
            await rm(old, { recursive: true, force: true }).catch(() => {});
            // Pi Pocket notices a changed module 300 ms after the change: let that pass before turning it on.
            await new Promise((resolve) => setTimeout(resolve, 800));

            // A new install is turned on; an update goes back to how it was.
            if (was === undefined || wasOn) {
                step("Turning it on…");
                await setEnabled(true);
            }
        } finally {
            await rm(staging, { recursive: true, force: true }).catch(() => {});
        }
    };

    /** Turns it off in Pi Pocket and removes its files. Its settings file and its saved state stay. */
    const remove = async (): Promise<void> => {
        if (installed() === undefined) {
            return;
        }

        if (host.local().url !== undefined) {
            await ask();

            if (module?.enabled === true) {
                await setEnabled(false);
            }
        }

        await rm(join(folder(), ADAPTER.file), { force: true });
        await rm(join(folder(), ADAPTER.folder), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
        module = undefined;
    };

    /** One action at a time; its steps and its error show in the card. */
    const act = async (name: string, work: (step: (text: string) => void) => Promise<void>): Promise<void> => {
        if (busy !== undefined) {
            throw new Error("Wait for the current step to end.");
        }

        message = undefined;
        busy = name;
        host.changed();

        try {
            await work((text) => {
                busy = text;
                host.changed();
            });
        } catch (error) {
            message = (error as Error).message;

            throw error;
        } finally {
            busy = undefined;
            host.changed();
        }
    };

    const updateAvailable = (): boolean => {
        const now = installed();

        return now?.commit !== undefined && latest !== undefined && latest.commit !== now.commit;
    };

    /** Looks for a newer commit; installs it when the setting says so and the app installed the one there. */
    const checkAndUpdate = async (): Promise<void> => {
        if (busy !== undefined || installed()?.commit === undefined || host.local().url === undefined) {
            return;
        }

        try {
            await check();
            host.changed();

            if (updateAvailable() && host.settings().billionContext.autoUpdate) {
                await act("Updating…", put);
            }
        } catch (error) {
            console.error("billion-context-pi update:", error);
        }
    };

    const schedule = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            void checkAndUpdate().finally(schedule);
        }, host.settings().updates.intervalHours * 3_600_000);
        timer.unref();
    };

    return {
        state(): BillionContextState {
            const local = host.local();
            const now = installed();

            return {
                server: host.settings().server.mode === "remote" ? "remote" : !local.installed ? "absent" : local.url === undefined ? "stopped" : "running",
                ...(now === undefined
                    ? {}
                    : {
                          installed: {
                              version: now.version,
                              ...(now.commit === undefined ? {} : { commit: now.commit }),
                              ...(module === undefined ? {} : { enabled: module.enabled }),
                              ...(module?.error === undefined ? {} : { error: module.error }),
                          },
                      }),
                foreign: now === undefined && foreign(),
                ...(latest === undefined ? {} : { latest }),
                ...(checkedAt === undefined ? {} : { checkedAt }),
                updateAvailable: updateAvailable(),
                ...(busy === undefined ? {} : { busy }),
                ...(message === undefined ? {} : { message }),
                folder: folder(),
                page: ADAPTER_PAGE,
                command: REMOTE_COMMAND,
            };
        },
        install: () => act("Installing…", put),
        update: () => act("Updating…", put),
        uninstall: () => act("Removing…", remove),
        enable: () => act("Turning it on…", () => setEnabled(true)),
        disable: () => act("Turning it off…", () => setEnabled(false)),
        check: () =>
            act("Looking for the newest version…", async () => {
                await check();
                await ask().catch(() => {});
            }),
        /** This computer's Pi Pocket is up: see whether the extension is on, and look for a newer one. */
        serverReady: (): void => {
            void ask()
                .catch(() => {})
                .then(() => {
                    host.changed();

                    return checkAndUpdate();
                });
            schedule();
        },
        serverDown: (): void => {
            module = undefined;
            clearTimeout(timer);
            host.changed();
        },
        reschedule: (): void => {
            if (timer !== undefined && host.local().url !== undefined) {
                schedule();
            }
        },
        quit: (): void => {
            clearTimeout(timer);
        },
    };
}
