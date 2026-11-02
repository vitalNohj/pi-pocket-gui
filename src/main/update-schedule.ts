/**
 * The repeated update check of this computer's Pi Pocket: one timer at most. It starts at the app's start in "This
 * computer" mode, for a linked runner, or when the person installs or starts Pi Pocket from "Another server". Pure of
 * Electron, with its timers given, for tests.
 */
export interface Timers<T> {
    set: (run: () => void, ms: number) => T;
    clear: (timer: T | undefined) => void;
}

export class UpdateSchedule<T = NodeJS.Timeout> {
    private timer: T | undefined;
    private active = false;

    constructor(
        /** The check; it does nothing when the settings turn automatic updates off (`keepUpdated`). */
        private readonly check: () => Promise<void>,
        private readonly hours: () => number,
        // Unref: the app keeps itself running; the timer alone must not keep a process (a test) alive.
        private readonly timers: Timers<T> = { set: (run, ms) => setTimeout(run, ms).unref() as T, clear: (timer) => clearTimeout(timer as NodeJS.Timeout) },
    ) {}

    /** Check now, and then every interval. */
    now(): void {
        this.active = true;
        void this.check();
        this.plan();
    }

    /** The person installed or started Pi Pocket: check now and then every interval, unless that already runs. */
    ensure(): void {
        if (!this.active) {
            this.now();
        }
    }

    /** The interval changed: the next check is one new interval from now. */
    plan(): void {
        this.timers.clear(this.timer);
        this.timer = this.timers.set(() => {
            void this.check().finally(() => this.plan());
        }, this.hours() * 3_600_000);
    }

    /** Uninstall, or the app's quit: no more checks until the next `now` or `ensure`. */
    stop(): void {
        this.timers.clear(this.timer);
        this.timer = undefined;
        this.active = false;
    }
}
