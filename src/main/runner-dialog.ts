/** Native session questions stay in the main process, separate from the server's page and its sign-in. */
import { app, dialog, Notification, type BaseWindow, type MessageBoxOptions } from "electron";
import type { RunnerConfirmation } from "./runner";

export async function askRunnerSession(
    window: BaseWindow,
    request: RunnerConfirmation,
    signal: AbortSignal,
): Promise<boolean> {
    if (signal.aborted) {
        return false;
    }

    // A hidden or minimized window must not own a sheet that the person cannot see.
    const visible = !window.isDestroyed() && window.isVisible() && !window.isMinimized();
    const session = request.kind === "fork" ? "a copy of a session" : "a session";
    const options: MessageBoxOptions = {
        type: "warning",
        title: "Allow a new session?",
        message: `${request.server} wants to start ${session} on this computer.`,
        detail: `Asked by: ${request.person}\nComputer: ${request.computer}\nFolder: ${request.folder}\n\nThe session can read and change files and run commands as you, also outside this folder.`,
        buttons: ["Deny", "Allow"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        signal,
    };
    let notification: Notification | undefined;
    let bounce: number | undefined;

    try {
        if (!visible && Notification.isSupported()) {
            notification = new Notification({
                title: "Allow a new session?",
                body: `${request.person} on ${request.server} wants to start ${session} in ${request.folder}. Open Pi Pocket to answer.`,
                urgency: "critical",
                timeoutType: "never",
            });
            notification.on("click", () => app.focus({ steal: true }));
            notification.show();
        }

        if (process.platform === "darwin") {
            bounce = app.dock?.bounce("critical");
            app.focus({ steal: true });
        } else {
            app.focus();
        }

        const { response } = await (visible ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options));

        return !signal.aborted && response === 1;
    } finally {
        notification?.close();

        if (bounce !== undefined && bounce >= 0) {
            app.dock?.cancelBounce(bounce);
        }
    }
}
