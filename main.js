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
    this.displays = new Map();   // graph view -> { el, input, onInput }

    this.addSettingTab(new GTTSSettingTab(this.app, this));

    // Capture phase so we intercept the keystroke before the graph canvas
    // consumes it (e.g. space/arrow keys that pan the view).
    this.registerDomEvent(document, "keydown", (evt) => this.handleKeydown(evt), {
      capture: true,
    });

    this.app.workspace.onLayoutReady(() => this.patchAllGraphLeaves());
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.patchAllGraphLeaves())
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.patchAllGraphLeaves())
    );

    this.register(() => this.cleanupAll());
  }

  onunload() {
    this.cleanupAll();
  }

  // ----- type-ahead -----

  // Route a printable keystroke (or Backspace) typed over a focused graph into
  // its search box. We edit the value directly rather than relying on focus:
  // when the controls panel is collapsed the input cannot receive focus, so
  // native typing — including Backspace — would never reach it.
  handleKeydown(evt) {
    if (evt.ctrlKey || evt.metaKey || evt.altKey) {
      return;
    }

    const isChar = evt.key.length === 1;   // printable single character
    const isBackspace = evt.key === "Backspace";
    if (!isChar && !isBackspace) {
      return;
    }

    const target = evt.target;
    if (this.isEditable(target)) {   // already typing in a real input — leave it alone
      return;
    }

    const view = this.graphViewFor(target);
    if (!view) {
      return;
    }

    const input = this.searchInputOf(view);
    if (!input) {
      return;
    }

    evt.preventDefault();
    evt.stopPropagation();

    input.value = isBackspace ? input.value.slice(0, -1) : input.value + evt.key;
    input.focus();
    input.dispatchEvent(new Event("input"));   // triggers the graph's live filter
  }

  isEditable(el) {
    if (!el || !el.tagName) {
      return false;
    }
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
  }

  // The graph view whose pane contains the keystroke target, falling back to
  // the active view when focus sits on a non-DOM-tracked element (e.g. body).
  graphViewFor(target) {
    const types = this.activeTypes();

    for (const type of types) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        if (target && leaf.view.containerEl.contains(target)) {
          return leaf.view;
        }
      }
    }

    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf && types.includes(activeLeaf.view.getViewType())) {
      return activeLeaf.view;
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

  // ----- query display (top-left overlay) -----

  patchAllGraphLeaves() {
    const live = new Set();
    for (const type of GRAPH_VIEW_TYPES) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        live.add(leaf.view);
        this.addDisplay(leaf.view);
      }
    }

    for (const view of this.displays.keys()) {
      if (!live.has(view)) {
        this.removeDisplay(view);
      }
    }
  }

  addDisplay(view) {
    if (!this.settings.showQueryDisplay || this.displays.has(view)) {
      return;
    }

    const input = this.searchInputOf(view);
    if (!input) {
      return;
    }

    const el = view.containerEl.createDiv({ cls: "gtts-query-display" });
    const onInput = () => this.renderDisplay(el, input.value);
    input.addEventListener("input", onInput);

    this.displays.set(view, { el, input, onInput });
    this.renderDisplay(el, input.value);
  }

  renderDisplay(el, value) {
    el.setText(value || "");
    el.toggleClass("is-empty", !value);
  }

  removeDisplay(view) {
    const d = this.displays.get(view);
    if (!d) {
      return;
    }

    d.input.removeEventListener("input", d.onInput);
    d.el.remove();
    this.displays.delete(view);
  }

  refreshDisplays() {
    for (const view of Array.from(this.displays.keys())) {
      this.removeDisplay(view);
    }
    this.patchAllGraphLeaves();
  }

  cleanupAll() {
    for (const view of Array.from(this.displays.keys())) {
      this.removeDisplay(view);
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
          this.plugin.refreshDisplays();
        })
      );
  }
}
