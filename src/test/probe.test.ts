import { strict as assert } from "node:assert";
import { test } from "node:test";
import { probe, type Fetch } from "../main/probe";
import { retryDelayMs } from "../main/backoff";

function server(routes: Record<string, () => Response>): Fetch {
    return async (url) => {
        const path = new URL(url).pathname;
        const route = routes[path];

        return route === undefined ? new Response("not found", { status: 404 }) : route();
    };
}

const json = (body: unknown) => () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

test("a server with the info route is detected with its bridge level", async () => {
    const result = await probe("127.0.0.1:8787", server({ "/api/pocket/info": json({ name: "pi-pocket", bridge: 1 }) }), 1000);

    assert.deepEqual(result, { kind: "detected", url: "http://127.0.0.1:8787", bridge: 1, via: "info" });
});

test("an older server is detected by its manifest, with no bridge", async () => {
    const result = await probe(
        "http://127.0.0.1:8787/pocket/",
        server({ "/pocket/manifest.webmanifest": json({ name: "Pi Pocket" }) }),
        1000,
    );

    assert.deepEqual(result, { kind: "detected", url: "http://127.0.0.1:8787/pocket", bridge: 0, via: "manifest" });
});

test("something else at the address is not detected", async () => {
    const result = await probe("127.0.0.1:3000", server({ "/manifest.webmanifest": json({ name: "Grafana" }) }), 1000);

    assert.equal(result.kind, "other");
});

test("a refused connection is unreachable, in words", async () => {
    const refused: Fetch = async () => {
        throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8787"), { code: "ECONNREFUSED" }) });
    };
    const result = await probe("127.0.0.1:8787", refused, 1000);

    assert.equal(result.kind, "unreachable");
    assert.equal(result.kind === "unreachable" && result.message, "No server is listening at that address and port.");
});

test("a server that never answers times out", async () => {
    const hang: Fetch = (_url, init) =>
        new Promise((_done, fail) => {
            init.signal.addEventListener("abort", () => {
                fail(init.signal.reason as Error);
            });
        });
    const result = await probe("127.0.0.1:8787", hang, 50);

    assert.equal(result.kind, "unreachable");
    assert.match(result.kind === "unreachable" ? result.message : "", /No answer within/);
});

test("an invalid address is not fetched", async () => {
    const result = await probe("file:///etc/passwd", () => assert.fail("fetched"), 1000);

    assert.equal(result.kind, "invalid");
});

test("a JSON API error cannot be opened, even when it redirects", async () => {
    for (const status of [200, 404]) {
        const api: Fetch = async () => {
            const response = new Response(JSON.stringify({ error: { message: "Not Found" } }), { status, headers: { "content-type": "application/json" } });

            Object.defineProperty(response, "redirected", { value: true });

            return response;
        };
        const result = await probe("https://example.com/codex/v1", api, 1000);

        assert.equal(result.kind, "other");
        assert.equal(result.kind === "other" && result.canOpen, false);
        assert.match(result.kind === "other" ? result.message : "", /browser address, not a model API address/);
    }
});

test("an HTML sign-in gateway is offered only as an unverified webpage", async () => {
    for (const status of [200, 401, 403]) {
        const gate: Fetch = async () => new Response("<html>Sign in</html>", { status, headers: { "content-type": "text/html; charset=utf-8" } });
        const result = await probe("https://example.com/pocket", gate, 1000);

        assert.equal(result.kind, "other");
        assert.equal(result.kind === "other" && result.canOpen, true);
    }
});

test("an HTML 404 is not treated as a sign-in page", async () => {
    const result = await probe("https://example.com/wrong", async () => new Response("<html>Not found</html>", { status: 404, headers: { "content-type": "text/html" } }), 1000);

    assert.equal(result.kind === "other" && result.canOpen, false);
});

test("another app’s JSON manifest is not an invitation to connect", async () => {
    const result = await probe("127.0.0.1:3000", server({ "/manifest.webmanifest": json({ name: "Grafana" }) }), 1000);

    assert.equal(result.kind === "other" && result.canOpen, false);
});

test("the wait between tries doubles up to the longest wait", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 40].map((attempt) => retryDelayMs(attempt, 30) / 1000), [2, 4, 8, 16, 30, 30, 30]);
});
