/**
 * This computer as a runner: the app runs `pi-pocket runner` (Pi Pocket's docs/runners.md) while it runs, so a Pi
 * Pocket server can run sessions' tools here: files and commands on this computer, the agent and its keys on the
 * server. It links with a one-time code the server's page gives (the bridge's `linkRunner`), keeps the link in the
 * app's own folder, and starts the runner again when it stops, unless the server ended the link for good.
 *
 * The runner comes from the Pi Pocket runtime the app installs (src/main/local-server.ts): one is installed for it
 * when there is none yet, also when the app connects to another server.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { RunnerState } from "../shared/types";
import { cleanLine } from "./local-versions";

/** `pi-pocket runner`'s exit code when the server ended the link for good: starting it again would not help. */
export const STOPPED_BY_SERVER = 3;
const LOG_LINES = 200;
const STOP_LIMIT_MS = 5000;

export interface RunnerHost {
    /** Where the link and its log go. */
    home: string;
    platform: NodeJS.Platform;
    /** Whether the person wants it running (the settings' runner.enabled). */
    enabled: () => boolean;
    setEnabled: (enabled: boolean) => Promise<void>;
    /** The installed runtime to run it from; undefined when there is none with the runner. */
    runtime: () => { node: string; launcher: string; bin: string } | undefined;
    /** Install Pi Pocket on this computer, or update it, so a runtime has the runner. */
    prepare: () => Promise<void>;
    environment: () => Promise<NodeJS.ProcessEnv>;
    changed: () => void;
}

/** What `runner.json` holds; the key stays in the file. */
interface Link {
    server: string;
    id: string;
    name: string;
}

/** The name this computer suggests for itself: its host name, without macOS's ".local" or a domain. */
export function computerName(name = hostname()): string {
    const short = name.replace(/\.local$/i, "").split(".")[0] ?? "";

    return short.replace(/-/g, " ").trim().slice(0, 60) || "This computer";
}

/** A line the runner printed, without its time stamp's brackets doubled and without colors. */
function plain(line: string): string {
    return cleanLine(line).trimEnd();
}

export function setUpRunner(host: RunnerHost) {
    const linkFile = join(host.home, "runner.json");
    let child: ChildProcess | undefined;
    let status: RunnerState["status"] = "off";
    let message: string | undefined;
    let lines: string[] = [];
    let failures = 0;
    let restartTimer: NodeJS.Timeout | undefined;
    let runningFrom: string | undefined;
    let busy: string | undefined;
    let quitting = false;

    const readLink = (): Link | undefined => {
        try {
            const value = JSON.parse(readFileSync(linkFile, "utf8")) as Partial<Link>;

            return typeof value.server === "string" && typeof value.id === "string" && typeof value.name === "string"
                ? { server: value.server, id: value.id, name: value.name }
                : undefined;
        } catch {
            return undefined;
        }
    };

    const set = (next: RunnerState["status"], text?: string) => {
        status = next;
        message = text;
        host.changed();
    };

    const log = (line: string) => {
        lines.push(plain(line));

        if (lines.length > LOG_LINES) {
            lines = lines.slice(-LOG_LINES);
        }
    };

    /** Runs the launcher with these runner arguments to its end: its output, or its last lines as the error. */
    const runOnce = async (args: string[]): Promise<string> => {
        const runtime = host.runtime();

        if (runtime === undefined) {
            throw new Error("Pi Pocket on this computer has no runner yet.");
        }

        const env = await host.environment();

        return new Promise((done, fail) => {
            const proc = spawn(runtime.node, [runtime.launcher, "runner", ...args, "--config", linkFile], {
                cwd: homedir(),
                env: { ...env, NO_COLOR: "1" },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            let output = "";
            const keep = (chunk: Buffer) => {
                output = `${output}${chunk.toString("utf8")}`.slice(-8000);
            };

            proc.stdout.on("data", keep);
            proc.stderr.on("data", keep);
            proc.on("error", fail);
            proc.on("close", (code) => {
                const text = output.split("\n").map(plain).filter(Boolean).join("\n");

                if (code === 0) {
                    done(text);
                } else {
                    fail(new Error(text.replace(/^pi-pocket runner: /gm, "") || `The runner stopped with code ${String(code)}.`));
                }
            });
        });
    };

    const start = async (): Promise<void> => {
        clearTimeout(restartTimer);

        if (child !== undefined || quitting || !host.enabled()) {
            return;
        }

        const link = readLink();

        if (link === undefined) {
            set("unlinked");

            return;
        }

        const runtime = host.runtime();

        if (runtime === undefined) {
            set("failed", "Pi Pocket on this computer has no runner. Install or update it under This computer.");

            return;
        }

        const env = await host.environment();
        const separator = host.platform === "win32" ? ";" : ":";

        if (child !== undefined || quitting || !host.enabled()) {
            return;
        }

        log(`— ${new Date().toISOString()} runner for ${link.server}, as "${link.name}"`);
        set("connecting", `Connecting to ${link.server}…`);

        const proc = spawn(runtime.node, [runtime.launcher, "runner", "--config", linkFile], {
            cwd: homedir(),
            // The person's tools first, as in their terminal; the runtime's Node and npm after.
            env: { ...env, PATH: `${env.PATH ?? ""}${separator}${runtime.bin}`, NO_COLOR: "1", PI_POCKET_DESKTOP_APP: "1" },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        child = proc;
        runningFrom = runtime.launcher;

        const onLine = (line: string) => {
            log(line);

            if (child !== proc) {
                return;
            }

            if (/\] (Connected to|Back with) /.test(line)) {
                failures = 0;
                set("connected");
            } else if (/\] Disconnected/.test(line)) {
                set("connecting", "Reconnecting; work that runs here waits.");
            } else if (/\] Connection: /.test(line) && status !== "connected") {
                set("connecting", plain(line).replace(/^\[[^\]]*\] Connection: /, "Cannot reach the server: "));
            }
        };

        readLines(proc.stdout, onLine);
        readLines(proc.stderr, onLine);
        proc.on("error", (error) => log(`Could not start: ${error.message}`));
        proc.on("close", (code, signal) => {
            if (child !== proc) {
                return;
            }

            child = undefined;
            runningFrom = undefined;

            if (quitting || status === "stopping" || !host.enabled()) {
                set(readLink() === undefined ? "unlinked" : "off");

                return;
            }

            const last = lines.at(-1)?.replace(/^pi-pocket runner: /, "") ?? "";

            if (code === STOPPED_BY_SERVER) {
                set("ended", last || "The server ended this computer's link. Link it again.");

                return;
            }

            failures += 1;
            const wait = Math.min(60, 2 ** Math.min(failures, 6));

            set("failed", `The runner stopped (${signal ?? `code ${String(code)}`}); starting it again in ${String(wait)} s. ${last}`.trim());
            restartTimer = setTimeout(() => void start(), wait * 1000);
        });
    };

    const stop = async (): Promise<void> => {
        clearTimeout(restartTimer);
        const proc = child;

        if (proc === undefined || proc.exitCode !== null) {
            return;
        }

        set("stopping");
        // It says goodbye to the server and stops its daemon; Windows has no SIGTERM, and it ends there at once.
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

    /** Work that takes a while, one at a time, shown while it runs. */
    const step = async <T>(text: string, work: () => Promise<T>): Promise<T> => {
        if (busy !== undefined) {
            throw new Error(`${busy} Wait for it to end.`);
        }

        busy = text;
        host.changed();

        try {
            return await work();
        } finally {
            busy = undefined;
            host.changed();
        }
    };

    return {
        state(): RunnerState {
            const link = readLink();

            return {
                status,
                ...(message === undefined ? {} : { message }),
                ...(link === undefined ? {} : { link }),
                ...(busy === undefined ? {} : { busy }),
                enabled: host.enabled(),
                available: host.runtime() !== undefined,
                computerName: computerName(),
                log: lines.slice(-40),
            };
        },
        /** The link, for the server's page: whether this computer is linked to it, and as which. */
        link: readLink,
        /** At the app's start: run it when it is on and linked. */
        boot: (): void => {
            if (readLink() === undefined) {
                set("unlinked");
            } else if (host.enabled()) {
                void start();
            } else {
                set("off");
            }
        },
        /**
         * Link this computer to `server` with a one-time code from it, then run the runner. Installs or updates Pi
         * Pocket on this computer first when it has no runner.
         */
        linkTo: (server: string, code: string): Promise<void> =>
            step("Linking this computer…", async () => {
                if (host.runtime() === undefined) {
                    busy = "Installing Pi Pocket on this computer for the runner…";
                    host.changed();
                    await host.prepare();

                    if (host.runtime() === undefined) {
                        throw new Error("Pi Pocket on this computer has no runner yet. Update it under This computer, then try again.");
                    }
                }

                await stop();
                await mkdir(host.home, { recursive: true });
                busy = "Linking this computer…";
                host.changed();
                log(await runOnce(["link", server, code]));
                failures = 0;
                await host.setEnabled(true);
                await start();
            }),
        /** Forget the link; the computer stays listed on the server until removed there. */
        unlink: (): Promise<void> =>
            step("Unlinking…", async () => {
                await stop();
                await rm(linkFile, { force: true });
                set("unlinked");
            }),
        /** Turn running it on or off (the setting already changed). */
        enabledChanged: (): void => {
            if (host.enabled()) {
                if (status === "ended") {
                    return;
                }

                void start();
            } else {
                void stop().then(() => set(readLink() === undefined ? "unlinked" : "off"));
            }
        },
        restart: async (): Promise<void> => {
            await stop();
            failures = 0;
            await start();
        },
        /** The runtimes changed (an update): run from the new one, since the old one goes away. */
        runtimeChanged: (): void => {
            const now = host.runtime()?.launcher;

            if (child !== undefined && now !== undefined && now !== runningFrom) {
                void stop().then(start);
            } else if (child === undefined && status === "failed" && now !== undefined && host.enabled()) {
                void start();
            }
        },
        linked: (): boolean => existsSync(linkFile),
        quit: async (): Promise<void> => {
            quitting = true;
            await stop();
        },
    };
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
