"use strict";

const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

const DEFAULT_SETTINGS = {
  enableInLocalGraph: true,   // also activate type-ahead in the local graph pane
  showQueryDisplay: true,     // show the current search query in the graph's top-left
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.states = new Map();   // graph view -> { realInput, proxy, displayEl, onRealInput, onProxyInput }

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

    // After any interaction inside the graph (panning, clicking a node), hand
    // keyboard focus back to the proxy so the next keystroke types into search.
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

  // Keep the proxy focused while a graph is active so the OS IME composes into
  // a real, focused input (Hangul/CJK can't be composed by injecting keys).
  focusActiveGraph() {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !this.activeTypes().includes(activeLeaf.view.getViewType())) {
      return;
    }

    this.focusProxy(activeLeaf.view);
  }

  focusProxy(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    state.proxy.value = state.realInput.value;   // resync after edits made elsewhere
    state.proxy.focus({ preventScroll: true });
  }

  onPointerUp(evt) {
    const view = this.containerViewFor(evt.target);
    if (!view || !this.activeTypes().includes(view.getViewType())) {
      return;
    }
    if (evt.target.closest && evt.target.closest(".graph-controls")) {   // let the real controls take focus
      return;
    }

    this.focusProxy(view);
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

    // Hidden, focusable input that hosts native (IME) text entry.
    const proxy = view.containerEl.createEl("input", { cls: "gtts-proxy", type: "text" });
    proxy.setAttribute("aria-hidden", "true");
    proxy.tabIndex = -1;

    const onProxyInput = () => {
      realInput.value = proxy.value;
      realInput.dispatchEvent(new Event("input"));   // drives the graph's live filter
    };
    proxy.addEventListener("input", onProxyInput);

    const displayEl = this.settings.showQueryDisplay
      ? view.containerEl.createDiv({ cls: "gtts-query-display" })
      : null;
    const onRealInput = () => {
      if (displayEl) {
        this.renderDisplay(displayEl, realInput.value);
      }
    };
    realInput.addEventListener("input", onRealInput);

    this.states.set(view, { realInput, proxy, displayEl, onRealInput, onProxyInput });
    onRealInput();
  }

  unpatchLeaf(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    state.proxy.removeEventListener("input", state.onProxyInput);
    state.realInput.removeEventListener("input", state.onRealInput);
    state.proxy.remove();
    if (state.displayEl) {
      state.displayEl.remove();
    }

    this.states.delete(view);
  }

  renderDisplay(el, value) {
    el.setText(value || "");
    el.toggleClass("is-empty", !value);
  }

  refresh() {
    for (const view of Array.from(this.states.keys())) {
      this.unpatchLeaf(view);
    }
    this.patchAllGraphLeaves();
    this.focusActiveGraph();
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
      .setDesc("Also start type-ahead search when the local graph pane is focused.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableInLocalGraph).onChange(async (v) => {
          this.plugin.settings.enableInLocalGraph = v;
          await this.plugin.saveData(this.plugin.settings);
        })
      );

    new Setting(containerEl)
      .setName("Show current query")
      .setDesc("Display the active search query in the top-left corner of the graph.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showQueryDisplay).onChange(async (v) => {
          this.plugin.settings.showQueryDisplay = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.refresh();
        })
      );
  }
}
