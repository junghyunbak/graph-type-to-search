"use strict";

const { Plugin, PluginSettingTab, Setting } = require("obsidian");

const GRAPH_VIEW_TYPES = ["graph", "localgraph"];

const DEFAULT_SETTINGS = {
  enableInLocalGraph: true,   // also show the bar in the local graph pane
  keepNodesVisible: true,     // when true, don't filter — keep every node and only ring matches
  ringColor: "#ff5582",       // color of the highlight ring on matching nodes
  ringGap: 4,                 // extra radius beyond the node (graph units)
  ringWidth: 4,               // ring stroke thickness (graph units)
  labelScale: 1,              // size multiplier for matching node titles (1 = no change)
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.states = new Map();   // graph view -> { bar, q, onBarInput }
    this.layers = new Map();   // graph view -> { renderer, hanger, rings: Map(id -> Graphics) }
    this._raf = 0;
    this._labelBase = 1;       // last seen zoom-based label scale of a non-matching node

    this.addSettingTab(new GTTSSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      this.patchAllGraphLeaves();
      this.focusActiveGraph();
      this.startLoop();
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

    // After panning or clicking a node, hand keyboard focus back to the bar.
    this.registerDomEvent(document, "pointerup", (evt) => this.onPointerUp(evt));

    this.register(() => this.cleanupAll());
  }

  onunload() {
    this.cleanupAll();
  }

  // ----- view lookup / helpers -----

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

  searchInputOf(view) {
    const search = view.dataEngine && view.dataEngine.filterOptions && view.dataEngine.filterOptions.search;
    if (search && search.inputEl) {
      return search.inputEl;
    }

    return view.containerEl.querySelector('input[type="search"]');
  }

  nodeList(renderer) {
    const raw = renderer && renderer.nodes;
    if (!raw) {
      return [];
    }
    return Array.isArray(raw) ? raw : Object.values(raw);
  }

  titleOf(node) {
    if (node.text && node.text.text) {
      return String(node.text.text);
    }
    let id = String(node.id || "").replace(/\.md$/i, "");
    const slash = id.lastIndexOf("/");
    return slash >= 0 ? id.slice(slash + 1) : id;
  }

  ringColorInt() {
    const n = parseInt(String(this.settings.ringColor).replace("#", ""), 16);
    return Number.isNaN(n) ? 0xff5582 : n;
  }

  // ----- focus handling -----

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
    // (including IME composition) and shows the current query.
    const bar = view.containerEl.createEl("input", { cls: "gtts-bar", type: "text" });
    bar.placeholder = "Type to highlight…";

    const state = { bar, q: "", onBarInput: null };
    state.onBarInput = () => {
      state.q = bar.value;
      this.applyFilter(view, state);
    };
    bar.addEventListener("input", state.onBarInput);

    this.states.set(view, state);
  }

  unpatchLeaf(view) {
    const state = this.states.get(view);
    if (!state) {
      return;
    }

    this.applyFilter(view, { q: "" });   // clear any built-in filter we set
    state.bar.removeEventListener("input", state.onBarInput);
    state.bar.remove();
    this.states.delete(view);
    this.clearLayer(view);
  }

  // ----- filtering (optional) -----

  // In the default mode the query is pushed into the graph's built-in search so
  // non-matching nodes are hidden. When "keep nodes visible" is on we keep the
  // built-in search empty and rely on the ring alone.
  applyFilter(view, state) {
    const real = this.searchInputOf(view);
    if (!real) {
      return;
    }

    const target = this.settings.keepNodesVisible ? "" : state.q;
    if (real.value !== target) {
      real.value = target;
      real.dispatchEvent(new Event("input"));
    }
  }

  reapplyFilter() {
    for (const [view, state] of this.states) {
      this.applyFilter(view, state);
    }
  }

  // ----- highlight rings (drawn into the renderer, same approach as Graph Unread Highlight) -----

  startLoop() {
    const step = () => {
      this.syncRings();
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  stopLoop() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
  }

  nodeRadius(node) {
    const w = node && node.circle && node.circle.width;
    return w ? w / 2 : 8;
  }

  // Hollow ring (no fill) sized just outside the node, so even tiny nodes stay
  // visible through it and node colors / color groups are untouched.
  drawRing(g, R) {
    const color = this.ringColorInt();
    const w = this.settings.ringWidth;
    g.clear();
    if (this._hasV8) {
      g.circle(0, 0, R).stroke({ width: w, color, alpha: 1 });
    } else {
      g.lineStyle(w, color, 1);
      g.drawCircle(0, 0, R);
    }
  }

  syncRings() {
    try {
      for (const [view, state] of this.states) {
        const renderer = view.renderer;
        const hanger = renderer && renderer.hanger;
        if (!hanger) {
          continue;
        }

        let layer = this.layers.get(view);
        if (!layer) {
          layer = { renderer, hanger, rings: new Map() };
          this.layers.set(view, layer);
        }
        layer.renderer = renderer;
        layer.hanger = hanger;

        const list = this.nodeList(renderer);

        // Reuse the same Graphics class as the existing node circles (matches
        // the app's exact PIXI build, v6/v7 vs v8).
        if (!this._GfxClass) {
          const s = list.find((n) => n && n.circle && n.circle.constructor);
          if (!s) {
            continue;
          }
          this._GfxClass = s.circle.constructor;
          this._hasV8 = typeof s.circle.circle === "function" && typeof s.circle.fill === "function";
          try { hanger.sortableChildren = true; } catch (e) {}
        }

        const q = state.q.trim().toLowerCase();
        const matches = (node) => q && node && node.id != null && this.titleOf(node).toLowerCase().includes(q);

        // The renderer scales every label uniformly with zoom; read that base
        // from a node we are NOT enlarging so our multiplier stays relative.
        const scale = this.settings.labelScale;
        if (scale !== 1) {
          const ref = list.find((n) => n && n.text && !matches(n));
          if (ref) {
            this._labelBase = ref.text.scale.x;
          }
        }

        const active = new Set();
        let changed = false;

        if (q) {
          for (const node of list) {
            if (!matches(node)) {
              continue;
            }

            let g = layer.rings.get(node.id);
            if (!g) {
              g = new this._GfxClass();
              g.zIndex = 100000;
              g._r = -1;
              hanger.addChild(g);
              layer.rings.set(node.id, g);
              changed = true;
            }
            g._node = node;
            g.position.set(node.x, node.y);
            const R = this.nodeRadius(node) + this.settings.ringGap;
            if (g._r !== R) {
              this.drawRing(g, R);
              g._r = R;
            }
            if (scale !== 1 && node.text) {
              const s = this._labelBase * scale;
              if (node.text._gttsScale !== s) {
                node.text.scale.set(s);
                node.text._gttsScale = s;
                changed = true;
              }
            }
            active.add(node.id);
          }
        }

        for (const [id, g] of layer.rings) {
          if (!active.has(id)) {
            this.unscaleText(g._node);
            hanger.removeChild(g);
            if (g.destroy) g.destroy();
            layer.rings.delete(id);
            changed = true;
          }
        }

        if (changed && renderer.changed) {
          renderer.changed();
        }
      }
    } catch (e) {
      if (!this._loggedErr) {
        console.error("[GTTS] syncRings error:", e);
        this._loggedErr = true;
      }
    }
  }

  // Restore a node label we enlarged back to the renderer's base scale.
  unscaleText(node) {
    const text = node && node.text;
    if (!text || text._gttsScale === undefined) {
      return;
    }
    text.scale.set(this._labelBase || 1);
    delete text._gttsScale;
  }

  // Reset every enlarged label (used when the size multiplier returns to 1).
  resetAllScales() {
    for (const view of this.states.keys()) {
      let changed = false;
      for (const node of this.nodeList(view.renderer)) {
        if (node && node.text && node.text._gttsScale !== undefined) {
          this.unscaleText(node);
          changed = true;
        }
      }
      if (changed && view.renderer && view.renderer.changed) {
        view.renderer.changed();
      }
    }
  }

  // Force a redraw of every ring next frame (after a color/size change).
  redrawAllRings() {
    for (const layer of this.layers.values()) {
      for (const g of layer.rings.values()) {
        g._r = -1;
      }
      if (layer.renderer && layer.renderer.changed) {
        layer.renderer.changed();
      }
    }
  }

  clearLayer(view) {
    const layer = this.layers.get(view);
    if (!layer) {
      return;
    }
    for (const g of layer.rings.values()) {
      this.unscaleText(g._node);
      if (layer.hanger) layer.hanger.removeChild(g);
      if (g.destroy) g.destroy();
    }
    layer.rings.clear();
    if (layer.renderer && layer.renderer.changed) layer.renderer.changed();
    this.layers.delete(view);
  }

  cleanupAll() {
    this.stopLoop();
    for (const view of Array.from(this.states.keys())) {
      this.unpatchLeaf(view);
    }
    for (const view of Array.from(this.layers.keys())) {
      this.clearLayer(view);
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
      .setName("Ring color")
      .setDesc("Color of the highlight ring drawn around nodes whose title matches the query.")
      .addColorPicker((c) =>
        c.setValue(this.plugin.settings.ringColor).onChange(async (v) => {
          this.plugin.settings.ringColor = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.redrawAllRings();
        })
      );

    new Setting(containerEl)
      .setName("Ring gap")
      .setDesc("How far the ring sits outside the node (graph units).")
      .addSlider((s) =>
        s.setLimits(0, 16, 1).setValue(this.plugin.settings.ringGap).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.ringGap = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.redrawAllRings();
        })
      );

    new Setting(containerEl)
      .setName("Ring thickness")
      .setDesc("Width of the ring stroke (graph units).")
      .addSlider((s) =>
        s.setLimits(1, 10, 0.5).setValue(this.plugin.settings.ringWidth).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.ringWidth = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.redrawAllRings();
        })
      );

    new Setting(containerEl)
      .setName("Highlighted label size")
      .setDesc("Size multiplier for the titles of matching nodes (1.0 = no change).")
      .addSlider((s) =>
        s.setLimits(1, 3, 0.1).setValue(this.plugin.settings.labelScale).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.labelScale = v;
          await this.plugin.saveData(this.plugin.settings);
          if (v === 1) {
            this.plugin.resetAllScales();
          }
        })
      );

    new Setting(containerEl)
      .setName("Keep all nodes visible")
      .setDesc("Don't hide non-matching nodes — keep the whole graph and only draw the ring on matches.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.keepNodesVisible).onChange(async (v) => {
          this.plugin.settings.keepNodesVisible = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.reapplyFilter();
        })
      );

    new Setting(containerEl)
      .setName("Enable in local graph")
      .setDesc("Also show the bar and highlight in the local graph pane.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableInLocalGraph).onChange(async (v) => {
          this.plugin.settings.enableInLocalGraph = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.patchAllGraphLeaves();
        })
      );
  }
}
