/** Where the window was and how big, kept in its own file so config.json stays for settings people edit. */
import { readFileSync } from "node:fs";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { screen, type Rectangle } from "electron";

export interface WindowState {
    bounds: Rectangle;
    maximized: boolean;
}

const DEFAULT: WindowState = { bounds: { x: 0, y: 0, width: 1280, height: 860 }, maximized: false };

export function loadWindowState(path: string): WindowState & { placed: boolean } {
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<WindowState>;
        const bounds = parsed.bounds;

        if (
            bounds !== undefined &&
            [bounds.x, bounds.y, bounds.width, bounds.height].every((each) => Number.isFinite(each)) &&
            bounds.width >= 400 &&
            bounds.height >= 300 &&
            onSomeDisplay(bounds)
        ) {
            return { bounds, maximized: parsed.maximized === true, placed: true };
        }
    } catch {
        // No file yet, or a broken one: start centered.
    }

    return { ...DEFAULT, placed: false };
}

/** A window saved on a screen that is no longer attached would open out of sight. */
function onSomeDisplay(bounds: Rectangle): boolean {
    return screen.getAllDisplays().some(({ workArea }) => {
        const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width);
        const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height);

        return right - Math.max(bounds.x, workArea.x) >= 100 && bottom - Math.max(bounds.y, workArea.y) >= 100;
    });
}

export function saveWindowState(path: string, state: WindowState): void {
    try {
        mkdirSync(dirname(path), { recursive: true });
        const temporary = `${path}.${String(process.pid)}.tmp`;

        writeFileSync(temporary, JSON.stringify(state));
        renameSync(temporary, path);
    } catch {
        // Losing the window's place is not worth an error.
    }
}
