/**
 * The two sides of Connection: This computer and Another server. Two things are kept apart: the side the settings
 * screen shows (the person can look at either), and the server the window uses (saved as `settings.server.mode`, the
 * side the app opens at start). Looking at a side changes nothing; only Connect, Start, Open, or a server that stops
 * does. Decisions only, independent of Electron: src/main/index.ts acts on them.
 */
import type { ChoiceStatus, ConfigReason, LocalState, ProbeResult, Side } from "../shared/types";

/** Why the window has no remote server: the connection dropped, or the last Connect failed. */
export interface RemoteError {
    /** The window's connection dropped (it was connected), or a Connect failed (it was not). */
    kind: "dropped" | "failed";
    url: string;
    /** One short line, for the Another server choice. */
    line: string;
}

/** The host of an address, for short lines: `pocket.example.com`. */
export function hostOf(url: string): string {
    try {
        return new URL(url).host || url;
    } catch {
        return url;
    }
}

export function stoppedAnswering(url: string): RemoteError {
    return { kind: "dropped", url, line: `${hostOf(url)} stopped answering` };
}

/** The page of another server did not load. */
export function didNotLoad(url: string): RemoteError {
    return { kind: "dropped", url, line: `${hostOf(url)} did not load` };
}

/** Connect found no Pi Pocket at the address. */
export function connectFailed(probe: ProbeResult): RemoteError {
    switch (probe.kind) {
        case "unreachable":
            return { kind: "failed", url: probe.url, line: `Cannot reach ${hostOf(probe.url)}` };
        case "invalid":
            return { kind: "failed", url: probe.url, line: "The address is not valid" };
        default:
            return { kind: "failed", url: probe.url, line: `No Pi Pocket at ${hostOf(probe.url)}` };
    }
}

/** The side a reason for the config screen belongs to; undefined: either. */
export function sideOf(reason: ConfigReason, inUse: Side): Side | undefined {
    switch (reason.kind) {
        case "local":
            return "local";
        case "not-detected":
        case "outage":
            return "remote";
        case "load-failed":
        case "crashed":
            return inUse;
        default:
            return undefined;
    }
}

/** Back to Pi Pocket, on the side shown: only to a server the window has loaded, and only on that server's side. */
export function canReturn(input: { inUse: Side; viewing: Side; loaded: boolean }): boolean {
    return input.loaded && input.inUse === input.viewing;
}

/**
 * This computer's Pi Pocket is ready. When the person asked for it (Start, Install), the window uses it and shows it:
 * that ends a connection to another server. When the window already uses it (the app's start, a start again after a
 * crash), it opens; it shows at once unless the person looks at Another server, where nothing jumps and Back waits on
 * This computer. A start the person did not ask for while another server is in use leaves the window where it is.
 */
export function whenLocalReady(input: { inUse: Side; asked: boolean; showing: "server" | "config"; viewing: Side }): "show" | "load" | "none" {
    if (input.asked) {
        return "show";
    }

    if (input.inUse !== "local") {
        return "none";
    }

    return input.showing === "server" || input.viewing === "local" ? "show" : "load";
}

/**
 * The server the window uses stopped. When its page shows, or the screen shows its side, the screen goes to its side
 * with the error, and a remote server is tried again. When the person looks at the other side, nothing jumps: the side
 * they look at stays, and the error waits on the lost server's side.
 */
export function whenLost(input: { lost: Side; showing: "server" | "config"; viewing: Side }): { show: boolean; viewing: Side; retry: boolean } {
    if (input.showing === "server" || input.viewing === input.lost) {
        return { show: true, viewing: input.lost, retry: input.lost === "remote" };
    }

    return { show: false, viewing: input.viewing, retry: false };
}

/** The config screen opened because the server failed, not because the person asked: go back once it answers. */
export function returnsByItself(reason: ConfigReason): boolean {
    return reason.kind === "outage" || reason.kind === "load-failed" || reason.kind === "not-detected";
}

/**
 * A background check found the lost server again. The app goes back to it only after a failure, with automatic
 * connections on, and only while the screen shows Another server: never while the person looks at This computer.
 */
export function reconnectsByItself(input: { reason: ConfigReason; viewing: Side; autoConnect: boolean }): boolean {
    return returnsByItself(input.reason) && input.autoConnect && input.viewing === "remote";
}

/**
 * The reason the screen opened belongs to one side (undefined: to both). On the other side it is not shown, so a
 * remote outage does not fill This computer, and comes back with Another server.
 */
export function shownReason(reason: ConfigReason, side: Side | undefined, viewing: Side): ConfigReason {
    return side === undefined || side === viewing ? reason : { kind: "user" };
}

/** The status on the This computer choice. */
export function localChoiceStatus(local: Pick<LocalState, "status" | "message" | "crash">): ChoiceStatus {
    switch (local.status) {
        case "absent":
            return { label: "Not installed", state: "other" };
        case "installing":
            return { label: "Not installed", state: "checking" };
        case "starting":
            return { label: "Starting", state: "checking" };
        case "running":
        case "external":
            return { label: "Running", state: "connected" };
        case "failed":
            return {
                label: "Error",
                state: "not-detected",
                detail: local.crash !== undefined ? `Stopped on its own: ${local.crash}` : local.message ?? "Pi Pocket stopped.",
            };
        case "stopped":
        case "stopping":
        default:
            return { label: "Stopped", state: "other" };
    }
}

/** The status on the Another server choice. */
export function remoteChoiceStatus(input: { connectedUrl: string | undefined; error: RemoteError | undefined }): ChoiceStatus {
    if (input.connectedUrl !== undefined) {
        return { label: "Connected", state: "connected" };
    }

    if (input.error !== undefined) {
        return { label: "Error", state: "not-detected", detail: input.error.line };
    }

    return { label: "Not connected", state: "checking" };
}

/** Why this computer's Pi Pocket went down (src/main/local-server.ts). */
export type LocalDown =
    /** It stopped on its own: a crash, or a start that failed. */
    | { kind: "crashed"; message: string }
    /** The person stopped it (Stop, Uninstall); not at a restart or the app's quit. */
    | { kind: "stopped" }
    /** A new version did not start: the one before starts again. */
    | { kind: "update-failed" }
    /** Not installed, the install failed, it was uninstalled, or another Pi Pocket answers at its port. */
    | { kind: "unavailable" };

/**
 * The desktop notification when this computer's Pi Pocket stops on its own: once for each stop, not for each try to
 * start it again; never for Stop, Uninstall, quitting the app, or an update that goes back to the version before.
 */
export class LocalStopNotice {
    private told = false;

    /** It is running again, or the person started or stopped it: a later stop is a new one. */
    reset(): void {
        this.told = false;
    }

    /** It went down: show a notification? */
    down(why: LocalDown, quitting: boolean): boolean {
        if (why.kind !== "crashed" || quitting || this.told) {
            return false;
        }

        this.told = true;

        return true;
    }
}
