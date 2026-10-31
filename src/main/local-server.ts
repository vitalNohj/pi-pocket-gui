/**
 * Pi Pocket on this computer: the app downloads a Node.js and installs Pi Pocket in it (a "runtime"), starts Pi
 * Pocket's launcher with it while the app runs, and builds a new runtime when either has a newer version. See
 * docs/local-server.md.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalState, LocalStatus, LocalUpdate, ProbeResult, Settings } from "../shared/types";
import { downloadChecked } from "./download";
import {
    cleanLine,
    compareVersions,
    pickNode,
    runtimePaths,
    satisfies,
    shasumFor,
    shasumsUrl,
    signInLine,
    type NodeDownload,
    type NodeRelease,
} from "./local-versions";

const REGISTRY = "https://registry.npmjs.org/pi-pocket/latest";
const NODE_INDEX = "https://nodejs.org/dist/index.json";
/** Pi Pocket's exit code for a problem in how it was started (a port in use, a held data folder): retrying won't help. */
const CONFIG_ERROR = 78;
/** A new runtime that is not ready by then goes back to the one before. */
const NEW_RUNTIME_LIMIT_MS = 120_000;
const STOP_LIMIT_MS = 15_000;
const LOG_LINES = 200;
const LOG_FILE_LIMIT = 2 * 1024 * 1024;

export interface LocalHost {
    /** Where the runtimes, downloads, and log go. */
    home: string;
    platform: NodeJS.Platform;
    arch: string;
    settings: () => Settings;
    fetch: (url: string) => Promise<Response>;
    /** Checks an address the way the config screen does. */
    probe: (url: string) => Promise<ProbeResult>;
    /** Anything in the state changed: show it. */
    changed: () => void;
    /** The server is ready: open the login link (a path with its token) at the address. */
    ready: (url: string, loginPath: string) => void;
    /** It stopped, failed, or was found running outside the app: the window cannot show it. */
    down: () => void;
}

/** One runtime, as current.json keeps it. */
interface Runtime {
    id: string;
    node: string;
}

interface Current {
    current?: Runtime;
    /** The runtime before an update, until the new one has started once. */
    previous?: Runtime;
    /** A runtime built by the app's update, waiting for the next start. */
    next?: Runtime;
}

export function setUpLocalServer(host: LocalHost) {
    const runtimes = join(host.home, "runtimes");
    const downloads = join(host.home, "downloads");
    const currentFile = join(host.home, "current.json");
    const logFile = join(host.home, "server.log");
    const pidFile = join(host.home, "launcher.pid");

    let status: LocalStatus = "stopped";
    let message: string | undefined;
    let progress: LocalState["progress"];
    let url: string | undefined;
    let lines: string[] = [];
    let child: ChildProcess | undefined;
    /** The settings it was started with: a change shows "restart needed". */
    let startedWith: string | undefined;
    let update: LocalUpdate = { status: "idle" };
    let updateTimer: NodeJS.Timeout | undefined;
    let restartTimer: NodeJS.Timeout | undefined;
    /** Starts that ended on their own in a row, for the wait before the next. */
    let failures = 0;
    /** One install or update build at a time. */
    let building: Promise<unknown> | undefined;
    let environment: Promise<NodeJS.ProcessEnv> | undefined;
    let quitting = false;

    const readCurrent = (): Current => {
        try {
            return JSON.parse(readFileSync(currentFile, "utf8")) as Current;
        } catch {
            return {};
        }
    };

    const writeCurrent = async (next: Current): Promise<void> => {
        await mkdir(host.home, { recursive: true });
        await writeFile(`${currentFile}.tmp`, `${JSON.stringify(next, null, 4)}\n`);
        await rename(`${currentFile}.tmp`, currentFile);
    };

    const paths = (runtime: Runtime) => runtimePaths(join(runtimes, runtime.id), host.platform);

    /** The Pi Pocket version in a runtime, as it is now: Pi Pocket may have updated itself in it. */
    const pocketVersion = (runtime: Runtime): string | undefined => {
        try {
            const manifest = JSON.parse(readFileSync(join(paths(runtime).pocket, "package.json"), "utf8")) as { version?: string };

            return manifest.version;
        } catch {
            return undefined;
        }
    };

    const usable = (runtime: Runtime | undefined): runtime is Runtime =>
        runtime !== undefined && existsSync(paths(runtime).node) && existsSync(paths(runtime).launcher);

    const changed = () => host.changed();

    const set = (next: LocalStatus, text?: string) => {
        status = next;
        message = text;

        if (next !== "installing") {
            progress = undefined;
        }

        changed();
    };

    const log = (line: string) => {
        const clean = cleanLine(line);

        lines.push(clean);

        if (lines.length > LOG_LINES) {
            lines = lines.slice(-LOG_LINES);
        }

        void appendFile(logFile, `${clean}\n`).catch(() => {});
    };

    const trimLog = async () => {
        const size = await stat(logFile).then((info) => info.size).catch(() => 0);

        if (size > LOG_FILE_LIMIT) {
            const text = await readFile(logFile, "utf8").catch(() => "");

            await writeFile(logFile, text.slice(-LOG_FILE_LIMIT / 2)).catch(() => {});
        }
    };

    const settingsKey = () => JSON.stringify(host.settings().local);

    // ——— Downloading and installing ———

    const fetchJson = async <T>(address: string): Promise<T> => {
        const response = await host.fetch(address);

        if (!response.ok) {
            throw new Error(`${address} answered HTTP ${String(response.status)}.`);
        }

        return (await response.json()) as T;
    };

    /** The newest Pi Pocket, and the newest Node.js LTS it runs on, for this computer. */
    const latest = async (): Promise<{ pocket: string; node: NodeDownload }> => {
        const manifest = await fetchJson<{ version: string; engines?: { node?: string } }>(REGISTRY);
        const releases = await fetchJson<NodeRelease[]>(NODE_INDEX);
        const engines = manifest.engines?.node ?? ">=22.19";
        const node = pickNode(releases, engines, host.platform, host.arch);

        if (node === undefined) {
            throw new Error(`No Node.js release for ${host.platform} ${host.arch} meets Pi Pocket's need (${engines}).`);
        }

        return { pocket: manifest.version, node };
    };

    /** Runs a command to its end; its last lines of output are the error when it fails. */
    const run = (file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void> =>
        new Promise((done, fail) => {
            const proc = spawn(file, args, { ...options, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
            let tail = "";
            const keep = (chunk: Buffer) => {
                tail = `${tail}${chunk.toString("utf8")}`.slice(-4000);
            };

            proc.stdout.on("data", keep);
            proc.stderr.on("data", keep);
            proc.on("error", fail);
            proc.on("close", (code) => {
                if (code === 0) {
                    done();
                } else {
                    const last = tail.trim().split("\n").slice(-6).map(cleanLine).join("\n");

                    fail(new Error(`${file.split(/[\\/]/).pop() ?? file} stopped with code ${String(code)}${last ? `:\n${last}` : "."}`));
                }
            });
        });

    const extract = async (archive: string, into: string): Promise<void> => {
        await mkdir(into, { recursive: true });
        // Windows 10 and later have bsdtar, which reads zip files too.
        const tar = host.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";

        await run(tar, ["-xf", archive, "-C", into], {});
    };

    /** Builds a runtime with these versions, in a folder of its own that takes its name only once whole. */
    const build = async (versions: { pocket: string; node: NodeDownload }, step: (text: string, percent?: number) => void): Promise<Runtime> => {
        await mkdir(downloads, { recursive: true });
        await mkdir(runtimes, { recursive: true });

        const archive = join(downloads, versions.node.file);

        if (!existsSync(archive)) {
            step(`Downloading Node.js ${versions.node.version}…`, 0);
            const sums = await host.fetch(shasumsUrl(versions.node.version)).then((response) => {
                if (!response.ok) {
                    throw new Error(`nodejs.org answered HTTP ${String(response.status)} for the checksums.`);
                }

                return response.text();
            });
            const sha256 = shasumFor(sums, versions.node.file);

            if (sha256 === undefined) {
                throw new Error(`nodejs.org lists no checksum for ${versions.node.file}.`);
            }

            await downloadChecked({
                url: versions.node.url,
                name: versions.node.file,
                folder: downloads,
                sha256,
                fetch: host.fetch,
                onProgress: (percent) => step(`Downloading Node.js ${versions.node.version}…`, percent),
            });
        }

        const id = `pi-pocket-${versions.pocket}-node-${versions.node.version}-${Date.now().toString(36)}`;
        const partial = join(runtimes, `${id}.partial`);

        await rm(partial, { recursive: true, force: true });

        try {
            step("Unpacking Node.js…");
            await extract(archive, partial);

            const unpacked = join(partial, versions.node.folder);
            const runtime: Runtime = { id, node: versions.node.version };
            const where = runtimePaths(unpacked, host.platform);

            step(`Installing Pi Pocket ${versions.pocket}…`);
            await run(
                where.node,
                [
                    where.npm,
                    "install",
                    "--global",
                    `--prefix=${unpacked}`,
                    "--ignore-scripts",
                    "--no-audit",
                    "--no-fund",
                    "--loglevel=error",
                    `pi-pocket@${versions.pocket}`,
                ],
                {
                    cwd: unpacked,
                    env: {
                        ...(await loginEnvironment()),
                        PATH: `${where.bin}${host.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
                        npm_config_update_notifier: "false",
                    },
                },
            );

            if (!existsSync(where.launcher)) {
                throw new Error("npm finished, but Pi Pocket's launcher is not where it should be.");
            }

            await pinNpm(unpacked, join(runtimes, id));

            await rename(unpacked, join(runtimes, id));

            return runtime;
        } finally {
            await rm(partial, { recursive: true, force: true });
        }
    };

    /**
     * Pi Pocket's own updater runs the npm beside its Node and asks it for the global folder: it must be this runtime's
     * own. On macOS and Linux `bin/npm` is a script that runs whichever `node` comes first on PATH (the person's), whose
     * global folder is elsewhere. So `bin/npm` and `bin/npx` run this runtime's Node, and npm's own config pins its
     * prefix to the runtime's final folder. Windows's npm.cmd already prefers the node.exe beside it.
     */
    const pinNpm = async (folder: string, final: string): Promise<void> => {
        const windows = host.platform === "win32";
        const npmFolder = windows ? join(folder, "node_modules", "npm") : join(folder, "lib", "node_modules", "npm");

        await writeFile(join(npmFolder, "npmrc"), `prefix=${final}\n`);

        if (windows) {
            return;
        }

        for (const tool of ["npm", "npx"]) {
            const file = join(folder, "bin", tool);

            await rm(file, { force: true });
            await writeFile(
                file,
                `#!/bin/sh\n# This runtime's ${tool}, always with this runtime's Node (the app wrote this).\nhere=$(dirname "$0")\nexec "$here/node" "$here/../lib/node_modules/npm/bin/${tool}-cli.js" "$@"\n`,
                { mode: 0o755 },
            );
        }
    };

    /** Removes the runtimes and downloads nothing points at any more. */
    const prune = async (): Promise<void> => {
        const keep = readCurrent();
        const ids = new Set([keep.current?.id, keep.previous?.id, keep.next?.id].filter((id) => id !== undefined));
        const nodes = new Set([keep.current?.node, keep.previous?.node, keep.next?.node].filter((node) => node !== undefined));

        for (const name of existsSync(runtimes) ? readdirSync(runtimes) : []) {
            if (!ids.has(name)) {
                await rm(join(runtimes, name), { recursive: true, force: true }).catch(() => {});
            }
        }

        for (const name of existsSync(downloads) ? readdirSync(downloads) : []) {
            if (![...nodes].some((node) => name.startsWith(`node-v${node}-`)) || name.endsWith(".part")) {
                await rm(join(downloads, name), { force: true }).catch(() => {});
            }
        }
    };

    const install = async (): Promise<void> => {
        if (building !== undefined) {
            await building;

            return;
        }

        building = (async () => {
            set("installing", "Looking for the newest Pi Pocket…");
            progress = { step: "Looking for the newest Pi Pocket…" };
            changed();

            let installed = false;

            try {
                const versions = await latest();
                const runtime = await build(versions, (text, percent) => {
                    progress = percent === undefined ? { step: text } : { step: text, percent };
                    message = text;
                    changed();
                });
                const before = readCurrent();

                await writeCurrent({ current: runtime, ...(before.current === undefined ? {} : { previous: before.current }) });
                set("stopped");
                installed = true;
            } catch (error) {
                set("failed", `The install failed: ${(error as Error).message}`);
                host.down();
            }

            return installed;
        })()
            .finally(() => {
                building = undefined;
            })
            // Started once the install is done: a start waits while one is under way.
            .then((installed) => (installed ? start() : undefined));

        await building;
    };

    // ——— The app's own update check ———

    const checkUpdates = async (force: boolean): Promise<void> => {
        const settings = host.settings();

        if ((!force && !settings.local.keepUpdated) || building !== undefined || update.status === "building") {
            return;
        }

        const current = readCurrent();

        if (!usable(current.current)) {
            return;
        }

        update = { status: "checking" };
        changed();

        try {
            const versions = await latest();
            const installed = current.next ?? current.current;
            const pocket = (current.next === undefined ? pocketVersion(current.current) : pocketVersion(current.next)) ?? "0.0.0";
            const newerPocket = compareVersions(versions.pocket, pocket) > 0;
            const newerNode = compareVersions(versions.node.version, installed.node) > 0;

            if (!newerPocket && !newerNode) {
                update = current.next === undefined
                    ? { status: "current", checkedAt: Date.now() }
                    : { status: "ready", pocket, node: installed.node, checkedAt: Date.now() };
                changed();

                return;
            }

            update = { status: "building", pocket: versions.pocket, node: versions.node.version };
            changed();

            const runtime = await build(versions, (text, percent) => {
                update = { ...update, message: text, ...(percent === undefined ? {} : { percent }) };
                changed();
            });

            await writeCurrent({ ...readCurrent(), next: runtime });
            await prune();
            update = { status: "ready", pocket: versions.pocket, node: versions.node.version, checkedAt: Date.now() };

            // Nothing runs: the new versions can take over now.
            if (child === undefined) {
                await adoptNext();
            }

            changed();
        } catch (error) {
            update = { status: "error", message: (error as Error).message, checkedAt: Date.now() };
            changed();
        }
    };

    const scheduleUpdates = (): void => {
        clearTimeout(updateTimer);
        const hours = host.settings().updates.intervalHours;

        updateTimer = setTimeout(() => {
            void checkUpdates(false).finally(scheduleUpdates);
        }, hours * 3_600_000);
    };

    /** The runtime an update built becomes the current one; the one before stays until the new one has started. */
    const adoptNext = async (): Promise<boolean> => {
        const current = readCurrent();

        if (!usable(current.next)) {
            return false;
        }

        await writeCurrent({ current: current.next, ...(current.current === undefined ? {} : { previous: current.current }) });
        update = { status: "current", checkedAt: Date.now() };

        return true;
    };

    // ——— Running ———

    /**
     * The person's own environment, as a terminal has it: an app started from the Dock or a menu gets a bare PATH,
     * and the agent should find the same tools as in a terminal.
     */
    const loginEnvironment = (): Promise<NodeJS.ProcessEnv> => {
        environment ??= (async () => {
            const base: NodeJS.ProcessEnv = { ...process.env };

            for (const key of Object.keys(base)) {
                if (key.startsWith("ELECTRON_") || key === "CHROME_DESKTOP" || key === "GOOGLE_API_KEY") {
                    delete base[key];
                }
            }

            if (host.platform === "win32") {
                return base;
            }

            const shell = process.env.SHELL ?? (host.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
            const marker = "__PI_POCKET_ENV__";

            return new Promise<NodeJS.ProcessEnv>((done) => {
                const proc = spawn(shell, ["-ilc", `printf '${marker}'; env -0`], {
                    stdio: ["ignore", "pipe", "ignore"],
                    env: base,
                    detached: false,
                });
                let output = "";
                const timer = setTimeout(() => proc.kill("SIGKILL"), 8000);

                proc.stdout.on("data", (chunk: Buffer) => {
                    output += chunk.toString("utf8");
                });
                proc.on("error", () => done(base));
                proc.on("close", () => {
                    clearTimeout(timer);
                    const start = output.indexOf(marker);

                    if (start === -1) {
                        done(base);

                        return;
                    }

                    const found: NodeJS.ProcessEnv = {};

                    for (const entry of output.slice(start + marker.length).split("\0")) {
                        const equals = entry.indexOf("=");

                        if (equals > 0) {
                            found[entry.slice(0, equals)] = entry.slice(equals + 1);
                        }
                    }

                    // Keep what only the app's process has (the display, the session bus), then the shell's own.
                    done(found.PATH === undefined ? base : { ...base, ...found });
                });
            });
        })();

        return environment;
    };

    const defaults = () => ({ folder: homedir(), data: join(homedir(), ".pi-pocket") });

    /** The address the window opens: this computer, except where Pi Pocket listens on the Tailscale address only. */
    const localUrl = (printed: string): string => {
        const settings = host.settings().local;

        return settings.access === "tailscale" ? new URL(printed).origin : `http://127.0.0.1:${String(settings.port)}`;
    };

    /** A launcher the app started and lost (the app crashed): stop it, so its port and data folder are free. */
    const stopLeftover = async (): Promise<void> => {
        const pid = Number(await readFile(pidFile, "utf8").catch(() => ""));

        if (!Number.isInteger(pid) || pid <= 0 || host.platform === "win32") {
            return;
        }

        const command = await new Promise<string>((done) => {
            const proc = spawn("ps", ["-p", String(pid), "-o", "command="], { stdio: ["ignore", "pipe", "ignore"] });
            let output = "";

            proc.stdout.on("data", (chunk: Buffer) => {
                output += chunk.toString("utf8");
            });
            proc.on("error", () => done(""));
            proc.on("close", () => done(output));
        });

        if (command.includes(runtimes) && command.includes("pi-pocket.js")) {
            process.kill(pid, "SIGTERM");

            for (let waited = 0; waited < STOP_LIMIT_MS; waited += 250) {
                await new Promise((resolve) => setTimeout(resolve, 250));

                try {
                    process.kill(pid, 0);
                } catch {
                    break;
                }
            }
        }

        await rm(pidFile, { force: true });
    };

    const start = async (): Promise<void> => {
        clearTimeout(restartTimer);

        if (child !== undefined || building !== undefined || quitting) {
            return;
        }

        const settings = host.settings();

        if (settings.server.mode !== "local") {
            return;
        }

        if (readCurrent().next !== undefined) {
            await adoptNext();
        }

        const current = readCurrent();

        if (!usable(current.current)) {
            if (usable(current.previous)) {
                await writeCurrent({ current: current.previous });
            } else {
                set("absent");
                host.down();

                return;
            }
        }

        const runtime = readCurrent().current!;
        const where = paths(runtime);
        const local = settings.local;

        set("starting", "Starting Pi Pocket…");
        await stopLeftover();

        // A Pi Pocket the app did not start already answers there: open that one rather than fight it for the port.
        const found = await host.probe(`http://127.0.0.1:${String(local.port)}`);

        if (found.kind === "detected") {
            url = found.url;
            set("external", `Pi Pocket already runs at ${found.url}, started outside this app.`);
            host.down();

            return;
        }

        const env = await loginEnvironment();
        const separator = host.platform === "win32" ? ";" : ":";
        const args = [
            where.launcher,
            "--access",
            local.access,
            "--yes",
            "--port",
            String(local.port),
            "--cwd",
            expand(local.folder) || defaults().folder,
            ...(local.data === "" ? [] : ["--data", expand(local.data)]),
        ];

        await trimLog();
        log(`— ${new Date().toISOString()} Pi Pocket ${pocketVersion(runtime) ?? "?"}, Node.js ${runtime.node}`);

        const proc = spawn(where.node, args, {
            cwd: expand(local.folder) || defaults().folder,
            env: {
                ...env,
                // Its own Node and npm last: the person's come first, and Pi Pocket's updater finds one either way.
                PATH: `${env.PATH ?? ""}${separator}${where.bin}`,
                NO_COLOR: "1",
                PI_POCKET_DESKTOP_APP: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const isNew = current.previous !== undefined;
        let ready = false;
        const watchdog = isNew
            ? setTimeout(() => {
                  if (!ready && child === proc) {
                      log("The new version did not get ready in 2 minutes: going back to the one before.");
                      proc.kill("SIGKILL");
                  }
              }, NEW_RUNTIME_LIMIT_MS)
            : undefined;

        child = proc;
        startedWith = settingsKey();

        if (proc.pid !== undefined) {
            void writeFile(pidFile, String(proc.pid)).catch(() => {});
        }

        const onLine = (line: string) => {
            log(line);

            const signIn = signInLine(line);

            if (signIn !== undefined && child === proc) {
                ready = true;
                clearTimeout(watchdog);
                failures = 0;
                url = localUrl(signIn.url);
                set("running");
                host.ready(url, signIn.loginPath);

                // The new runtime started: the one before is no longer needed.
                if (isNew) {
                    void writeCurrent({ current: runtime }).then(prune);
                }
            }
        };

        readLines(proc.stdout, onLine);
        readLines(proc.stderr, onLine);
        proc.on("error", (error) => {
            log(`Could not start: ${error.message}`);
        });
        proc.on("close", (code, signal) => {
            clearTimeout(watchdog);

            if (child !== proc) {
                return;
            }

            child = undefined;
            url = undefined;
            void rm(pidFile, { force: true });

            if (quitting || status === "stopping") {
                set("stopped");

                return;
            }

            host.down();

            // A new runtime that never got ready: back to the one before.
            if (!ready && isNew) {
                const before = readCurrent();

                if (usable(before.previous)) {
                    void writeCurrent({ current: before.previous }).then(async () => {
                        update = { status: "error", message: "The new version did not start, so the one before runs again.", checkedAt: Date.now() };
                        set("stopped");
                        await start();
                    });

                    return;
                }
            }

            const last = cause(lines);

            if (code === CONFIG_ERROR) {
                set("failed", last || "Pi Pocket could not start with these settings.");

                return;
            }

            failures += 1;

            if (failures > 5) {
                set("failed", `Pi Pocket stopped ${String(failures)} times in a row (${signal ?? `code ${String(code)}`}). ${last}`);

                return;
            }

            const wait = Math.min(60, 2 ** failures);

            set("failed", `Pi Pocket stopped (${signal ?? `code ${String(code)}`}). Starting it again in ${String(wait)} s. ${last}`);
            restartTimer = setTimeout(() => void start(), wait * 1000);
        });
    };

    const stop = async (): Promise<void> => {
        clearTimeout(restartTimer);
        const proc = child;

        if (proc === undefined || proc.exitCode !== null) {
            if (status !== "absent" && status !== "installing") {
                set("stopped");
            }

            return;
        }

        set("stopping", "Stopping Pi Pocket…");

        // The launcher stops the server (sessions resume at the next start) and its tunnel. Windows has no SIGTERM:
        // the server notices its launcher is gone and stops by itself.
        proc.kill("SIGTERM");

        const timer = setTimeout(() => proc.kill("SIGKILL"), STOP_LIMIT_MS);

        await new Promise<void>((resolve) => {
            if (proc.exitCode !== null || proc.signalCode !== null) {
                resolve();
            } else {
                proc.once("close", () => resolve());
            }
        });
        clearTimeout(timer);
    };

    const restart = async (): Promise<void> => {
        await stop();
        await start();
    };

    return {
        state(): LocalState {
            const current = readCurrent();
            const runtime = current.current;
            const pocket = runtime === undefined ? undefined : pocketVersion(runtime);

            return {
                status,
                ...(message === undefined ? {} : { message }),
                ...(progress === undefined ? {} : { progress }),
                ...(runtime !== undefined && pocket !== undefined ? { installed: { pocket, node: runtime.node } } : {}),
                ...(url === undefined ? {} : { url }),
                log: lines.slice(-40),
                restartNeeded: child !== undefined && startedWith !== undefined && startedWith !== settingsKey(),
                update,
                defaults: defaults(),
                home: host.home,
            };
        },
        installed: () => usable(readCurrent().current),
        url: () => url,
        /** At the app's start, in local mode: start it when installed, and look for updates. */
        boot: async (): Promise<void> => {
            await prune().catch(() => {});

            if (!usable(readCurrent().current)) {
                set("absent");
                host.down();
            } else {
                await start();
            }

            void checkUpdates(false);
            scheduleUpdates();
        },
        install,
        start,
        stop,
        restart,
        checkUpdates: () => checkUpdates(true),
        rescheduleUpdates: scheduleUpdates,
        /** The tray's line for a new version waiting for a restart. */
        trayItem: (): { label: string; click: () => void } | undefined =>
            update.status === "ready" && child !== undefined
                ? { label: `Restart Pi Pocket to update to ${update.pocket ?? "the new version"}`, click: () => void restart() }
                : undefined,
        logFile,
        /** At the app's quit: stop it, and wait. */
        quit: async (): Promise<void> => {
            quitting = true;
            clearTimeout(updateTimer);
            await stop();
        },
    };
}

/** Lines the launcher prints around a failure that say nothing about its cause. */
const NOISE = /^(Pi Pocket could not start|Stopping Pi Pocket|Starting Pi Pocket|— \d{4}-|The server stopped .* trying again|Press q)/;

/** Why the last start failed, from what the launcher printed in it, in the app's words. */
export function cause(lines: string[]): string {
    const since = lines.findLastIndex((line) => line.startsWith("— "));
    const own = lines
        .slice(since + 1)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !NOISE.test(line));
    const text = own.slice(-2).join(" ");

    return text
        .replace("Pick another with --port.", "Pick another port below.")
        .replace("Fix the problem above, or pick another access mode with --access.", "Fix it, or pick another choice in Who can connect.");
}

/** `~` at the start of a path is the home folder. */
function expand(path: string): string {
    return path === "~" ? homedir() : path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}

function readLines(stream: NodeJS.ReadableStream, listener: (line: string) => void): void {
    let buffer = "";

    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf("\n");

        while (newline !== -1) {
            listener(buffer.slice(0, newline).replace(/\r$/, ""));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
        }
    });
    stream.on("end", () => {
        if (buffer !== "") {
            listener(buffer);
        }
    });
}

export { satisfies };
