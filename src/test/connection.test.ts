import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mayConnect, pageProblem } from "../main/connection";
import type { ProbeResult } from "../shared/types";

const detected: ProbeResult = { kind: "detected", url: "http://localhost:8787", bridge: 1, via: "info" };
const other: ProbeResult = { kind: "other", url: "http://localhost:8787/api", status: 404, message: "Not Pi Pocket", canOpen: false };

test("only detection or explicit permission for an unverified HTML page allows a connection", () => {
    assert.equal(mayConnect(detected), true);
    assert.equal(mayConnect({ ...other, canOpen: true }), false);
    assert.equal(mayConnect({ ...other, canOpen: true }, true), true);

    for (const result of [other, { kind: "invalid", url: "file:///", message: "Invalid" }, { kind: "unreachable", url: other.url, message: "Offline" }] satisfies ProbeResult[]) {
        assert.equal(mayConnect(result), false);
        assert.equal(mayConnect(result, true), false, "Open anyway cannot override an error/API response");
    }
});

test("HTTP errors are failures even when Chromium successfully loads their HTML", () => {
    for (const status of [400, 401, 403, 404, 500, 502, 503]) {
        assert.match(pageProblem(status, "text/html") ?? "", new RegExp(`HTTP ${String(status)}`));
    }
});

test("successful JSON, plain-text, and other non-webpage responses return to settings", () => {
    for (const type of ["application/json", "application/problem+json; charset=utf-8", "text/plain", "application/xml"]) {
        assert.match(pageProblem(200, type) ?? "", /not the Pi Pocket webpage/);
        assert.notEqual(pageProblem(200, type, true), undefined);
    }
});

test("HTML pages and intermediate redirects are not mistaken for errors", () => {
    assert.equal(pageProblem(200, "Text/HTML; charset=UTF-8"), undefined);
    assert.equal(pageProblem(200, "application/xhtml+xml"), undefined);
    assert.equal(pageProblem(200, ""), undefined);
    assert.equal(pageProblem(302, "application/json"), undefined);
});

test("an explicitly opened gateway may serve its sign-in form with HTTP 401 or 403", () => {
    for (const status of [401, 403]) {
        assert.equal(pageProblem(status, "text/html", true), undefined);
        assert.notEqual(pageProblem(status, "application/json", true), undefined);
    }

    assert.notEqual(pageProblem(404, "text/html", true), undefined);
});
