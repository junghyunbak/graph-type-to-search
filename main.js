"use strict";

const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];
const NO_TINT = 0xffffff;

const DEFAULT_SETTINGS = {
  enableInLocalGraph: true,   // also show the highlight bar in the local graph pane
  highlightColor: "#ff5582",  // tint applied to matching node titles
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.states = new Map();   // graph view -> { bar, query, onBarInput }

    this.addSettingTab(new GTTSSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.patchAllGraphLeaves();
      this.focusActiveGraph();
    });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.patchAllGraphLeaves())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.patchAllGraphLeaves();
        this.focusActiveGraph();
      })
    );

    // After panning or clicking a node, hand keyboard focus back to the bar so
    // the next keystroke types into the highlight query.
    this.registerDomEvent(document, "pointerup", (evt) => this.onPointerUp(evt));

    // Re-apply the tint periodically so labels that appear on zoom-in (and new
    // nodes) get highlighted too. Cheap: it only repaints when a tint changes.
    this.registerInterval(window.setInterval(() => this.tick(), 150));

    this.register(() => this.cleanupAll());
  }

  onunload() {
    this.cleanupAll();
  }

  // ----- view lookup -----

  containerViewFor(target) {
    if (!target) {
      return null;
    }
    for (const type of this.activeTypes()) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (leaf.view.containerEl.contains(target)) {
          return leaf.view;
        }
      }
    }

    return null;
  }

  activeTypes() {
    return this.settings.enableInLocalGraph ? GRAPH_VIEW_TYPES : ["graph"];
  }

  colorInt() {
    const n = parseInt(String(this.settings.highlightColor).replace("#", ""), 16);
    return Number.isNaN(n) ? 0xff5582 : n;
  }

  nodeList(renderer) {
    const raw = renderer && renderer.nodes;
    if (!raw) {
      return [];
    }
    return Array.isArray(raw) ? raw : Object.values(raw);
  }

  // ----- focus handling -----

  // Keep the bar focused while a graph is active so the OS IME composes into a
  // real, focused, visible input.
  focusActiveGraph() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !this.activeTypes().includes(activeLeaf.view.getViewType())) {
      return;
    }

    this.focusBar(activeLeaf.view);
  }

  focusBar(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    state.bar.focus({ preventScroll: true });
  }

  onPointerUp(evt) {
    const view = this.containerViewFor(evt.target);
    if (!view) {
      return;
    }
    if (evt.target.closest && evt.target.closest(".gtts-bar, .graph-controls")) {
      return;
    }

    this.focusBar(view);
  }

  // ----- per-leaf wiring -----

  patchAllGraphLeaves() {
    const live = new Set();
    for (const type of this.activeTypes()) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        live.add(leaf.view);
        this.patchLeaf(leaf.view);
      }
    }

    for (const view of this.states.keys()) {
      if (!live.has(view)) {
        this.unpatchLeaf(view);
      }
    }
  }

  patchLeaf(view) {
    if (this.states.has(view)) {
      return;
    }

    // Visible, focusable bar pinned to the top-left. Hosts native text entry
    // (including IME composition) and shows the current highlight query.
    const bar = view.containerEl.createEl("input", { cls: "gtts-bar", type: "text" });
    bar.placeholder = "Type to highlight…";

    const state = { bar, query: "", onBarInput: null };
    state.onBarInput = () => {
      state.query = bar.value.trim().toLowerCase();
      if (!state.query) {
        this.restoreView(view);
      }
    };
    bar.addEventListener("input", state.onBarInput);

    this.states.set(view, state);
  }

  unpatchLeaf(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    this.restoreView(view);
    state.bar.removeEventListener("input", state.onBarInput);
    state.bar.remove();

    this.states.delete(view);
  }

  // ----- highlight engine -----

  tick() {
    for (const [view, state] of this.states) {
      if (state.query) {
        this.applyView(view, state.query);
      }
    }
  }

  applyView(view, query) {
    const renderer = view.renderer;
    const color = this.colorInt();
    let changed = false;

    for (const node of this.nodeList(renderer)) {
      const text = node && node.text;
      if (!text) {
        continue;
      }
      if (text._gttsOrig === undefined) {
        text._gttsOrig = text.tint;
      }

      const want = String(text.text || "").toLowerCase().includes(query) ? color : text._gttsOrig;
      if (text.tint !== want) {
        text.tint = want;
        changed = true;
      }
    }

    if (changed && renderer.changed) {
      renderer.changed();
    }
  }

  restoreView(view) {
    const renderer = view.renderer;
    let changed = false;

    for (const node of this.nodeList(renderer)) {
      const text = node && node.text;
      if (!text || text._gttsOrig === undefined) {
        continue;
      }
      if (text.tint !== text._gttsOrig) {
        text.tint = text._gttsOrig;
        changed = true;
      }
      delete text._gttsOrig;
    }

    if (changed && renderer.changed) {
      renderer.changed();
    }
  }

  cleanupAll() {
    for (const view of Array.from(this.states.keys())) {
      this.unpatchLeaf(view);
    }
  }
};

class GTTSSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Highlight color")
      .setDesc("Tint applied to the titles of nodes whose title matches the query.")
      .addColorPicker((c) =>
        c.setValue(this.plugin.settings.highlightColor).onChange(async (v) => {
          this.plugin.settings.highlightColor = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Enable in local graph")
      .setDesc("Also show the highlight bar and keep it focused in the local graph pane.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableInLocalGraph).onChange(async (v) => {
          this.plugin.settings.enableInLocalGraph = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.patchAllGraphLeaves();
        })
      );
  }
}
