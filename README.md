# Graph Type to Search

An Obsidian plugin that brings **type-ahead highlighting** to the **graph view**. Just start typing while the graph is focused and matching node titles are **emphasized instantly** — without filtering anything out, so the whole graph stays on screen for context. No need to press `Cmd/Ctrl+F` or click into a search box first.

## Why this plugin exists

Obsidian's built-in graph search filters live as you type — but it *removes* every non-matching node, and only *after* you focus its search box (via `Cmd/Ctrl+F` or a click). Sometimes you don't want to lose the surrounding graph; you just want to **see where the matches are** while keeping the full layout.

This plugin does that: type, and the titles of matching nodes light up in a color of your choice while every other node stays exactly where it is.

## How it works

While a graph (or local graph) pane is active, the plugin shows a small **bar pinned to the top-left** and keeps it focused for you. Just start typing — anything you enter (including **IME composition for Hangul / CJK**, Backspace, and text selection) goes natively into the bar.

As the query changes, the plugin tints the **label of every node whose title contains the query** with the highlight color, and leaves all other nodes untouched. Nothing is hidden or removed. Clearing the bar restores every label.

Using a real, focused, **visible** input is what makes **Korean and other IME input compose correctly**: you can't redirect a composition that began while another element had focus, and a hidden host would draw the composition caret at its off-screen corner instead of where the text is. After you pan or click in the graph, focus is handed back to the bar on pointer-up so the next keystroke goes straight into the query.

The highlight is drawn by tinting each node label in the graph's own renderer, so it tracks pan, zoom and simulation automatically, and re-applies to labels that only appear when you zoom in.

## Settings

- **Highlight color** — the tint applied to matching node titles (defaults to a vivid pink, fully customizable via a color picker).
- **Enable in local graph** — also show the bar and highlight in the local graph pane (on by default).

## Notes

This plugin draws into the graph view's internal renderer (PIXI) and reads its node labels, which are not part of the public plugin API and may change in future Obsidian versions. Because each label is a single rasterized text object, only the **whole** title can be emphasized — matched substrings within a title cannot be highlighted individually. It is desktop-only.

## License

[MIT](LICENSE)
