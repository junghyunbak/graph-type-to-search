# Graph Type to Search

An Obsidian plugin that brings **type-ahead search** to the **graph view**. Just start typing while the graph is focused and the filter runs **instantly** — no need to press `Cmd/Ctrl+F` or click into the search box first, the same way you'd speed-search a tree or table in an IDE.

## Why this plugin exists

Obsidian's graph view already filters live as you type — but only *after* you focus its search box (via `Cmd/Ctrl+F` or a click). That extra step breaks the flow: you look at the graph, then have to reach for a shortcut before a single keystroke does anything.

This plugin removes that step. While a graph pane is focused, the first printable key you press is routed straight into the graph's built-in search box and the filter updates immediately. Every following keystroke goes to the search box as usual.

## How it works

While a graph (or local graph) pane is active, the plugin shows a small **filter bar pinned to the top-left** and keeps it focused for you. Just start typing — anything you enter (including **IME composition for Hangul / CJK**, Backspace, and text selection) goes natively into the bar, and its value is mirrored into the graph's built-in **"Search files…"** query so the graph's normal **live filter** kicks in.

Using a real, focused, **visible** input is what makes **Korean and other IME input compose correctly**: you can't redirect a composition that began while another element had focus, and a hidden host would draw the composition caret at its off-screen corner instead of where the text is. After you pan or click in the graph, focus is handed back to the bar on pointer-up so the next keystroke goes straight to search.

It mirrors into the graph view's own search component (`dataEngine.filterOptions.search`), so filtering behaves exactly like typing into the box by hand — your color groups, filters and display settings are untouched. Because the bar is its own input, this also works with the graph **controls panel collapsed**, and the bar always shows the current query at a glance.

## Settings

- **Enable in local graph** — also show the filter bar and keep it focused in the local graph pane (on by default).

## Notes

This plugin reads the graph view's internal `dataEngine`, which is not part of the public plugin API and may change in future Obsidian versions. It is desktop-only.

## License

[MIT](LICENSE)
