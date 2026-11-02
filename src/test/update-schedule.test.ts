import { strict as assert } from "node:assert";
import { test } from "node:test";
import { UpdateSchedule } from "../main/update-schedule";

/** A schedule with fake timers: the test runs a due check by hand. */
function schedule(hours = 6) {
    let checks = 0;
    const timers = new Map<number, { run: () => void; ms: number }>();
    let next = 0;
    const updates = new UpdateSchedule<number>(
        async () => { checks++; },
        () => hours,
        { set: (run, ms) => { timers.set(++next, { run, ms }); return next; }, clear: (id) => { if (id !== undefined) timers.delete(id); } },
    );

    return { updates, checks: () => checks, timers, setHours: (value: number) => { hours = value; } };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("Start or Install from Another server checks now and sets one repeated check (F2)", async () => {
    const { updates, checks, timers } = schedule();

    updates.ensure();
    assert.equal(checks(), 1);
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0]!.ms, 6 * 3_600_000);
    // Start again, Install, or a linked runner: no second check now, and no second timer.
    updates.ensure();
    updates.ensure();
    assert.equal(checks(), 1);
    assert.equal(timers.size, 1);
    // The timer is due: one check, and one timer for the next.
    [...timers.values()][0]!.run();
    await flush();
    assert.equal(checks(), 2);
    assert.equal(timers.size, 1);
});

test("at the app's start in local mode the check runs; a later Start does not add a timer", () => {
    const { updates, checks, timers } = schedule();

    updates.now();
    updates.ensure();
    assert.equal(checks(), 1);
    assert.equal(timers.size, 1);
});

test("a new interval replaces the timer; Uninstall and quit stop it, and a later Start sets it again", () => {
    const { updates, checks, timers, setHours } = schedule();

    updates.ensure();
    setHours(12);
    updates.plan();
    assert.equal(timers.size, 1);
    assert.equal([...timers.values()][0]!.ms, 12 * 3_600_000);
    updates.stop();
    assert.equal(timers.size, 0);
    updates.ensure();
    assert.equal(checks(), 2);
    assert.equal(timers.size, 1);
});
