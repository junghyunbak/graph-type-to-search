# Graph Type to Search

An Obsidian plugin that brings **type-ahead search** to the **graph view**. Just start typing while the graph is focused and the filter runs **instantly** — no need to press `Cmd/Ctrl+F` or click into the search box first, the same way you'd speed-search a tree or table in an IDE.

## Why this plugin exists

Obsidian's graph view already filters live as you type — but only *after* you focus its search box (via `Cmd/Ctrl+F` or a click). That extra step breaks the flow: you look at the graph, then have to reach for a shortcut before a single keystroke does anything.

This plugin removes that step. While a graph pane is focused, the first printable key you press is routed straight into the graph's built-in search box and the filter updates immediately. Every following keystroke goes to the search box as usual.

## How it works

While a graph (or local graph) pane is active, the plugin keeps a tiny **hidden, focusable input** focused for you. Anything you type — including **IME composition for Hangul / CJK**, Backspace, and text selection — is entered natively into that input, and its value is mirrored into the graph's built-in **"Search files…"** query, firing the input event so the graph's normal **live filter** kicks in.

Using a real focused input (rather than injecting individual keystrokes) is what makes **Korean and other IME input compose correctly** — you can't redirect a composition that began while another element had focus, so the host input must already be focused before you type. It also means the search box itself never needs to be focusable, so this keeps working with the graph **controls panel collapsed**. After you pan or click in the graph, focus is handed back to the hidden input on pointer-up so the next keystroke goes straight to search.

It mirrors into the graph view's own search component (`dataEngine.filterOptions.search`), so filtering behaves exactly like typing into the box by hand — your color groups, filters and display settings are untouched.

The active query is also shown in a small pill in the **top-left** of the graph, so you can see what's filtering the view at a glance — even with the controls panel collapsed.

## Settings

- **Enable in local graph** — also start type-ahead search when the local graph pane is focused (on by default).
- **Show current query** — display the active search query in the top-left corner of the graph (on by default).

## Notes

This plugin reads the graph view's internal `dataEngine`, which is not part of the public plugin API and may change in future Obsidian versions. It is desktop-only.

## License

[MIT](LICENSE)
