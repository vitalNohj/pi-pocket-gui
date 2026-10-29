/**
 * What the server's page sends through the host bridge, checked: the page is another program, and may be of another
 * version, so every value is read as unknown and anything wrong is dropped. Pure functions.
 */
import type { HostNotification, PinnedSession, PinState } from "../shared/types";

const PIN_STATES = new Set<PinState>(["waiting", "limited", "working", "failed", "fresh", "seen"]);
const MAX_PINS = 20;
const MAX_TEXT = 4000;

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function text(value: unknown, max = MAX_TEXT): string | undefined {
    return typeof value === "string" ? value.slice(0, max) : undefined;
}

/** A path on the server's own origin: "/s/12", "/?pip=1", "/". Nothing with a scheme or a host. */
export function serverPath(value: unknown): string | undefined {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
        return undefined;
    }

    try {
        const url = new URL(value, "http://pocket.invalid");

        return url.origin === "http://pocket.invalid" ? `${url.pathname}${url.search}` : undefined;
    } catch {
        return undefined;
    }
}

export function readBadge(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? Math.min(value, 9999) : undefined;
}

export function readNotification(value: unknown): HostNotification | undefined {
    const input = record(value);
    const title = text(input?.title, 300);
    const url = serverPath(input?.url);

    if (input === undefined || title === undefined || url === undefined) {
        return undefined;
    }

    const approval = record(input.approval);
    const id = text(approval?.id, 200);
    const call = text(approval?.call, 100_000);

    return {
        title,
        body: text(input.body) ?? "",
        url,
        tag: text(input.tag, 200) ?? "",
        urgency: input.urgency === "high" ? "high" : "normal",
        ...(approval !== undefined && id !== undefined && id !== "" && call !== undefined
            ? { approval: { id, call, may: approval.may === true, allow: approval.allow === true } }
            : {}),
    };
}

export function readPinned(value: unknown): PinnedSession[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const pins: PinnedSession[] = [];

    for (const each of value.slice(0, MAX_PINS)) {
        const pin = record(each);
        const id = pin?.id;
        const url = serverPath(pin?.url);

        if (pin === undefined || typeof id !== "number" || !Number.isInteger(id) || url === undefined) {
            continue;
        }

        const state = PIN_STATES.has(pin.state as PinState) ? (pin.state as PinState) : "seen";

        pins.push({ id, title: text(pin.title, 200) ?? `Session ${id}`, state, label: text(pin.label, 200) ?? "", url });
    }

    return pins;
}

/** How a pin's state reads in the tray menu: a mark like the square in Pi Pocket's sidebar. */
export const PIN_MARKS: Record<PinState, string> = {
    waiting: "◆",
    limited: "◷",
    working: "◐",
    failed: "✕",
    fresh: "●",
    seen: "○",
};

/** A tray menu item's label: the mark, then the title cut to fit a menu. */
export function pinLabel(pin: PinnedSession): string {
    const chars = Array.from(pin.title.replace(/\s+/g, " ").trim());
    const title = chars.length > 48 ? `${chars.slice(0, 47).join("")}…` : chars.join("");

    // A menu reads "&" as a mnemonic on Windows and Linux.
    return `${PIN_MARKS[pin.state]}  ${title.replace(/&/g, "&&")}`;
}
