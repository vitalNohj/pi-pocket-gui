/**
 * How a notification shows what Pi Pocket sends: an approval's call made safe to read (invisible and reordering
 * characters shown as marks, cut to a length), and whether its notification offers Allow. Pure functions.
 */
import type { AllowFromNotification } from "../shared/types";

/**
 * Characters that change how text reads without being seen: controls (but tab and line breaks), format characters
 * (zero-width ones, the byte order mark, bidirectional embeddings, overrides, and isolates), and the line and
 * paragraph separators.
 */
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
const KEPT = new Set(["\n", "\t"]);

function hex(char: string): string {
    return (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0");
}

/** The text with each hidden character as a visible mark, such as ⟨U+202E⟩, and whether there was one. */
export function markHidden(text: string): { text: string; marked: boolean } {
    let marked = false;
    const out = text.replace(HIDDEN, (char) => {
        if (KEPT.has(char)) {
            return char;
        }

        marked = true;

        return `⟨U+${hex(char)}⟩`;
    });

    return { text: out, marked };
}

/** What an approval's notification shows of the call, and whether that is all of it, as it is. */
export interface ShownCall {
    text: string;
    /** The whole call shows, with no mark and nothing cut. */
    whole: boolean;
}

export function showCall(call: string, maxLength: number): ShownCall {
    const { text, marked } = markHidden(call);
    const chars = Array.from(text);

    if (chars.length <= maxLength) {
        return { text, whole: !marked };
    }

    return { text: `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}…`, whole: false };
}

/** Whether an approval's notification offers Allow. Deny is always offered. */
export function offersAllow(setting: AllowFromNotification, may: boolean, shown: ShownCall): boolean {
    if (!may) {
        return false;
    }

    if (setting === "always") {
        return true;
    }

    return setting === "whenFullyShown" && shown.whole;
}
