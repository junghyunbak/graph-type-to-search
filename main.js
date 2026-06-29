"use strict";

const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

const DEFAULT_SETTINGS = {
  enableInLocalGraph: true,   // also activate type-ahead in the local graph pane
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.addSettingTab(new GTTSSettingTab(this.app, this));

    // Capture phase so we intercept the keystroke before the graph canvas
    // consumes it (e.g. space/arrow keys that pan the view).
    this.registerDomEvent(document, "keydown", (evt) => this.handleKeydown(evt), {
      capture: true,
    });
  }

  // Route a printable keystroke typed over a focused graph into its search box.
  handleKeydown(evt) {
    if (evt.ctrlKey || evt.metaKey || evt.altKey) {
      return;
    }
    if (evt.key.length !== 1) {   // only printable single characters
      return;
    }

    const target = evt.target;
    if (this.isEditable(target)) {   // already typing somewhere — leave it alone
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

    input.focus();
    input.value += evt.key;
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
  }
}
