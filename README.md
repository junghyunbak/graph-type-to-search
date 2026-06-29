# Graph Type to Search

An Obsidian plugin that brings **type-ahead search** to the **graph view**. Just start typing while the graph is focused and the filter runs **instantly** — no need to press `Cmd/Ctrl+F` or click into the search box first, the same way you'd speed-search a tree or table in an IDE.

## Why this plugin exists

Obsidian's graph view already filters live as you type — but only *after* you focus its search box (via `Cmd/Ctrl+F` or a click). That extra step breaks the flow: you look at the graph, then have to reach for a shortcut before a single keystroke does anything.

This plugin removes that step. While a graph pane is focused, the first printable key you press is routed straight into the graph's built-in search box and the filter updates immediately. Every following keystroke goes to the search box as usual.

## How it works

The plugin listens for `keydown` while a graph (or local graph) pane is focused. When you press a printable character — and you're **not** already typing in some other input — it edits the graph's built-in **"Search files…"** query directly and fires the input event so the graph's normal **live filter** kicks in. **Backspace** deletes from the query the same way.

It writes straight to the query rather than relying on the box having focus, so it keeps working even when the graph **controls panel is collapsed** (where the search box can't be focused). It uses the graph view's own search component (`dataEngine.filterOptions.search`), so filtering behaves exactly like typing into the box by hand — your color groups, filters and display settings are untouched. Modifier combos (`Cmd`, `Ctrl`, `Alt`) are ignored so shortcuts still work.

The active query is also shown in a small pill in the **top-left** of the graph, so you can see what's filtering the view at a glance — even with the controls panel collapsed.

## Settings

- **Enable in local graph** — also start type-ahead search when the local graph pane is focused (on by default).
- **Show current query** — display the active search query in the top-left corner of the graph (on by default).

## Notes

This plugin reads the graph view's internal `dataEngine`, which is not part of the public plugin API and may change in future Obsidian versions. It is desktop-only.

## License

[MIT](LICENSE)
