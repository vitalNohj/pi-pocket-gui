/**
 * The right-click menu on Pi Pocket's pages: spelling suggestions on a misspelled word, the edit commands that apply
 * where the click was, and (in the main window) the app's GUI Settings. Built from what Electron says about the
 * click (`context-menu`'s params), with no Electron at run time, so the tests can build it too.
 */
import type { ContextMenuParams, MenuItemConstructorOptions } from "electron";

/** The most suggestions shown: the spellchecker's first are its best. */
export const MAX_SUGGESTIONS = 5;

/** What the click knew, as far as the menu needs it. */
export type ClickInfo = Pick<
    ContextMenuParams,
    "misspelledWord" | "dictionarySuggestions" | "isEditable" | "selectionText" | "editFlags"
>;

export interface MenuActions {
    /** Puts the suggestion in place of the misspelled word. */
    replace: (word: string) => void;
    /** Adds the word to the spellchecker's own dictionary, so it is never marked again. */
    learn: (word: string) => void;
    /** The app's GUI Settings; left out where the window has none (a page opened in a window of its own). */
    openSettings?: () => void;
}

export function contextMenuTemplate(click: ClickInfo, actions: MenuActions): MenuItemConstructorOptions[] {
    const groups: MenuItemConstructorOptions[][] = [];
    const word = click.misspelledWord.trim();

    if (click.isEditable && word !== "") {
        const suggestions = click.dictionarySuggestions.slice(0, MAX_SUGGESTIONS);

        groups.push([
            ...(suggestions.length > 0
                ? suggestions.map((suggestion) => ({ label: suggestion, click: () => actions.replace(suggestion) }))
                : [{ label: "No suggestions", enabled: false }]),
            { label: `Add “${word}” to dictionary`, click: () => actions.learn(word) },
        ]);
    }

    if (click.isEditable) {
        groups.push([
            { role: "cut", enabled: click.editFlags.canCut },
            { role: "copy", enabled: click.editFlags.canCopy },
            { role: "paste", enabled: click.editFlags.canPaste },
            { type: "separator" },
            { role: "selectAll", enabled: click.editFlags.canSelectAll },
        ]);
    } else {
        groups.push([{ role: "copy", enabled: click.selectionText !== "" }]);
    }

    if (actions.openSettings !== undefined) {
        groups.push([{ label: "GUI Settings…", accelerator: "CommandOrControl+,", click: actions.openSettings }]);
    }

    return groups.flatMap((group, index) => (index === 0 ? group : [{ type: "separator" as const }, ...group]));
}
