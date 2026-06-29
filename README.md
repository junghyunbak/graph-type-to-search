# Graph Type to Search

An Obsidian plugin that brings **type-ahead search** to the **graph view**. Just start typing while the graph is focused — no need to press `Cmd/Ctrl+F` or click into a search box first. Matching nodes get a **highlight ring**, and by default non-matching nodes are filtered out (you can keep them visible instead).

## Why this plugin exists

Obsidian's built-in graph search filters live as you type, but only *after* you focus its search box. This plugin removes that step and adds a visible **ring around matching nodes** so they stand out at a glance — optionally without hiding the rest of the graph, when you want to keep the surrounding context.

## How it works

While a graph (or local graph) pane is active, the plugin shows a small **bar pinned to the top-left** and keeps it focused for you. Just start typing — anything you enter (including **IME composition for Hangul / CJK**, Backspace, and text selection) goes natively into the bar.

As the query changes, the plugin draws a **hollow highlight ring** around every node whose **title contains the query**. The ring is drawn into the graph's own renderer (the same approach as the *Graph Unread Highlight* plugin), so it tracks pan, zoom and the simulation automatically, sits just outside each node, and never changes node colors or color groups.

By default the query is also pushed into the graph's built-in search, so **non-matching nodes are hidden** (and the surviving matches keep their ring). Turn on **Keep all nodes visible** to skip the filtering and keep the entire graph on screen, with only the matches ringed.

Using a real, focused, **visible** input is what makes **Korean and other IME input compose correctly**: you can't redirect a composition that began while another element had focus, and a hidden host would draw the composition caret at its off-screen corner instead of where the text is. After you pan or click in the graph, focus is handed back to the bar on pointer-up so the next keystroke goes straight into the query.

## Settings

- **Ring color** — color of the highlight ring (color picker; defaults to a vivid pink).
- **Ring gap** — how far the ring sits outside the node.
- **Ring thickness** — width of the ring stroke.
- **Keep all nodes visible** — don't hide non-matching nodes; keep the whole graph and only ring the matches (off by default).
- **Enable in local graph** — also show the bar and highlight in the local graph pane (on by default).

## Notes

This plugin draws into the graph view's internal renderer (PIXI) and uses its internal search component, neither of which is part of the public plugin API; they may change in future Obsidian versions. It is desktop-only.

## License

[MIT](LICENSE)
