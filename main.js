"use strict";

const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

const DEFAULT_SETTINGS = {
  enableInLocalGraph: true,   // also activate type-ahead in the local graph pane
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.states = new Map();   // graph view -> { realInput, bar, onRealInput, onBarInput }
    this._mirroring = false;   // guards the bar <-> real-input echo loop

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
    // the next keystroke types into search.
    this.registerDomEvent(document, "pointerup", (evt) => this.onPointerUp(evt));

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
    for (const type of GRAPH_VIEW_TYPES) {
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

  searchInputOf(view) {
    const search = view.dataEngine && view.dataEngine.filterOptions && view.dataEngine.filterOptions.search;
    if (search && search.inputEl) {
      return search.inputEl;
    }

    return view.containerEl.querySelector('input[type="search"]');
  }

  // ----- focus handling -----

  // Keep the bar focused while a graph is active so the OS IME composes into a
  // real, focused, *visible* input (a hidden host would draw the composition
  // caret at its off-screen corner instead of where the text is).
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
    if (!view || !this.activeTypes().includes(view.getViewType())) {
      return;
    }
    // Leave focus alone when the user is interacting with the bar itself or the
    // graph's own controls (so caret placement and the real search box work).
    if (evt.target.closest && evt.target.closest(".gtts-bar, .graph-controls")) {
      return;
    }

    this.focusBar(view);
  }

  // ----- per-leaf wiring -----

  patchAllGraphLeaves() {
    const live = new Set();
    for (const type of GRAPH_VIEW_TYPES) {
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

    const realInput = this.searchInputOf(view);
    if (!realInput) {
      return;
    }

    // Visible, focusable filter bar pinned to the top-left. Hosts native text
    // entry (including IME composition) and shows the current query.
    const bar = view.containerEl.createEl("input", { cls: "gtts-bar", type: "text" });
    bar.placeholder = "Type to filter…";

    const onBarInput = () => {
      this._mirroring = true;
      realInput.value = bar.value;
      realInput.dispatchEvent(new Event("input"));   // drives the graph's live filter
      this._mirroring = false;
    };
    bar.addEventListener("input", onBarInput);

    // Reflect changes made elsewhere (clear button, typing in the real box)
    // back into the bar — but never while we are the source of the change.
    const onRealInput = () => {
      if (this._mirroring || bar.value === realInput.value) {
        return;
      }
      bar.value = realInput.value;
    };
    realInput.addEventListener("input", onRealInput);

    this.states.set(view, { realInput, bar, onRealInput, onBarInput });
    bar.value = realInput.value;
  }

  unpatchLeaf(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    state.bar.removeEventListener("input", state.onBarInput);
    state.realInput.removeEventListener("input", state.onRealInput);
    state.bar.remove();

    this.states.delete(view);
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
      .setName("Enable in local graph")
      .setDesc("Also show the filter bar and keep it focused in the local graph pane.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableInLocalGraph).onChange(async (v) => {
          this.plugin.settings.enableInLocalGraph = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );
  }
}
