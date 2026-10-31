import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { MenuItemConstructorOptions } from "electron";
import { contextMenuTemplate, MAX_SUGGESTIONS, type ClickInfo } from "../main/context-menu";

const flags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false };

function click(over: Partial<ClickInfo>): ClickInfo {
    return { misspelledWord: "", dictionarySuggestions: [], isEditable: false, selectionText: "", editFlags: flags, ...over };
}

const labels = (items: MenuItemConstructorOptions[]) => items.map((item) => item.label ?? item.role ?? item.type);

test("a misspelled word in a text field: its suggestions first, then add to dictionary, then the edit commands", () => {
    const replaced: string[] = [];
    const learned: string[] = [];
    const items = contextMenuTemplate(click({ isEditable: true, misspelledWord: "teh", dictionarySuggestions: ["the", "tea", "ten"] }), {
        replace: (word) => replaced.push(word),
        learn: (word) => learned.push(word),
        openSettings: () => undefined,
    });

    assert.deepEqual(labels(items), [
        "the",
        "tea",
        "ten",
        "Add “teh” to dictionary",
        "separator",
        "cut",
        "copy",
        "paste",
        "separator",
        "selectAll",
        "separator",
        "Server settings…",
    ]);

    (items[0]!.click as () => void)();
    (items[3]!.click as () => void)();
    assert.deepEqual(replaced, ["the"]);
    assert.deepEqual(learned, ["teh"]);
});

test("at most a few suggestions, and a disabled line when there are none", () => {
    const many = contextMenuTemplate(
        click({ isEditable: true, misspelledWord: "x", dictionarySuggestions: ["a", "b", "c", "d", "e", "f", "g"] }),
        { replace: () => undefined, learn: () => undefined },
    );

    assert.equal(many.indexOf(many.find((item) => item.label?.startsWith("Add"))!), MAX_SUGGESTIONS);

    const none = contextMenuTemplate(click({ isEditable: true, misspelledWord: "qzxv" }), { replace: () => undefined, learn: () => undefined });

    assert.equal(none[0]!.label, "No suggestions");
    assert.equal(none[0]!.enabled, false);
});

test("no spelling items outside a misspelled word; outside a text field only copy, enabled by a selection", () => {
    const field = contextMenuTemplate(click({ isEditable: true }), { replace: () => undefined, learn: () => undefined });

    assert.deepEqual(labels(field), ["cut", "copy", "paste", "separator", "selectAll"]);

    const page = contextMenuTemplate(click({ misspelledWord: "teh", selectionText: "" }), { replace: () => undefined, learn: () => undefined });

    assert.deepEqual(labels(page), ["copy"]);
    assert.equal(page[0]!.enabled, false);
    assert.equal(contextMenuTemplate(click({ selectionText: "hi" }), { replace: () => undefined, learn: () => undefined })[0]!.enabled, true);
});
