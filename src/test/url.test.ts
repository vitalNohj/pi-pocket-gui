import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeServerUrl } from "../main/url";

const ok = (input: string) => {
    const result = normalizeServerUrl(input);

    assert.ok(result.ok, `${input}: ${result.ok ? "" : result.message}`);

    return result.url;
};

test("adds a scheme: http on loopback, private, and Tailscale addresses; https on public names", () => {
    assert.equal(ok("127.0.0.1:8787"), "http://127.0.0.1:8787");
    assert.equal(ok("localhost:9000"), "http://localhost:9000");
    assert.equal(ok("192.168.1.20:8787"), "http://192.168.1.20:8787");
    assert.equal(ok("100.102.233.84:8787"), "http://100.102.233.84:8787");
    assert.equal(ok("opti2:8787"), "http://opti2:8787");
    assert.equal(ok("opti2.tail1234.ts.net"), "https://opti2.tail1234.ts.net");
    assert.equal(ok("[::1]:8787"), "http://[::1]:8787");
});

test("keeps a path, drops trailing slashes, the query, and the fragment", () => {
    assert.equal(ok("https://example.com/pocket/"), "https://example.com/pocket");
    assert.equal(ok("http://127.0.0.1:8787/?x=1#y"), "http://127.0.0.1:8787");
    assert.equal(ok("  http://127.0.0.1:8787  "), "http://127.0.0.1:8787");
});

test("refuses other schemes, sign-ins in the address, and nonsense", () => {
    for (const input of ["", "file:///etc/passwd", "javascript:alert(1)", "ftp://x", "http://user:pw@host", "http://"]) {
        assert.equal(normalizeServerUrl(input).ok, false, input);
    }
});
