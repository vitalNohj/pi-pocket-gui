import { strict as assert } from "node:assert";
import { join } from "node:path";
import { test } from "node:test";
import { engineNative, engineSize, MODELS, modelById, modelConfig, VAD } from "../main/dictation-catalog";
import { validateSettings } from "../main/settings";

test("every model is pinned: https, a size, and a SHA-256 for each file", () => {
    const ids = new Set<string>();

    for (const model of MODELS) {
        assert.ok(!ids.has(model.id), `${model.id} twice`);
        ids.add(model.id);
        assert.ok(model.files.length > 0);

        for (const file of model.files) {
            assert.match(file.url, /^https:\/\//);
            assert.match(file.sha256, /^[0-9a-f]{64}$/);
            assert.ok(file.size > 0);
            // Pinned to a commit, never a branch that can move.
            assert.doesNotMatch(file.url, /\/resolve\/main\//);
        }
    }
});

test("each model's config names files it downloads", () => {
    for (const model of MODELS) {
        const config = modelConfig(model, "/m", 2, join);
        const names = new Set(model.files.map((file) => join("/m", file.name)));
        const paths = JSON.stringify(config).match(/"\/m\/[^"]+"/g) ?? [];

        assert.ok(paths.length > 0, model.id);

        for (const path of paths) {
            assert.ok(names.has(JSON.parse(path) as string), `${model.id}: ${path}`);
        }
    }
});

test("the engine exists for the six desktop builds, and nowhere else", () => {
    for (const platform of ["darwin", "linux", "win32"]) {
        for (const arch of ["x64", "arm64"]) {
            assert.ok(engineNative(platform, arch), `${platform}-${arch}`);
        }
    }

    assert.equal(engineNative("linux", "ia32"), undefined);
    assert.equal(engineNative("freebsd", "x64"), undefined);
    assert.ok(engineSize("linux", "x64") > VAD.size);
});

test("the chosen model is a known id or none", () => {
    assert.equal(validateSettings({ dictation: { model: "whisper-tiny" } }).settings.dictation.model, "whisper-tiny");
    assert.equal(validateSettings({}).settings.dictation.model, "");

    const bad = validateSettings({ dictation: { model: "gpt-voice", live: "yes" } });

    assert.equal(bad.settings.dictation.model, "");
    assert.equal(bad.settings.dictation.live, true);
    assert.equal(bad.problems.length, 2);
    assert.ok(modelById("parakeet-tdt-0.6b-v2")?.recommended);
});
