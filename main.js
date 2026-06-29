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
  glow: true,                 // soft multi-layer glow ring instead of a crisp stroke
  pulse: true,                // gently animate the ring (breathing)
  dimNonMatches: true,        // fade non-matching nodes/labels so matches pop
  dimOpacity: 0.15,           // opacity of dimmed (non-matching) nodes
};

module.exports = class GraphTypeToSearch extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.states = new Map();   // graph view -> { bar, q, onBarInput }
    this.layers = new Map();   // graph view -> { renderer, hanger, rings: Map(id -> Graphics) }
    this._raf = 0;

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

  strokeCircle(g, r, w, color, alpha) {
    if (this._hasV8) {
      g.circle(0, 0, r).stroke({ width: w, color, alpha });
    } else {
      g.lineStyle(w, color, alpha);
      g.drawCircle(0, 0, r);
    }
  }

  // Hollow ring (no fill) sized just outside the node, so even tiny nodes stay
  // visible through it and node colors / color groups are untouched. With glow
  // on, faint wider rings are layered outside a bright inner ring; `bright`
  // (0..1, driven by the pulse) modulates overall opacity.
  drawRing(g, R, bright) {
    const color = this.ringColorInt();
    const w = this.settings.ringWidth;
    g.clear();

    if (!this.settings.glow) {
      this.strokeCircle(g, R, w, color, bright);
      return;
    }

    this.strokeCircle(g, R + w * 2, w, color, 0.12 * bright);
    this.strokeCircle(g, R + w, w, color, 0.28 * bright);
    this.strokeCircle(g, R, w, color, 0.95 * bright);
  }

  syncRings() {
    try {
      this._phase = (this._phase || 0) + 0.09;   // advances the pulse once per frame
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

        // We enlarge a matching label by bumping its font size — text.scale gets
        // clobbered by the renderer every frame, font size does not (the renderer
        // only recomputes it on zoom).
        const scale = this.settings.labelScale;

        // Pulse: a 0..1 breathing factor (1 when pulse is off, so rings draw at
        // full strength and only redraw when geometry changes).
        const pulse = this.settings.pulse && !!q;
        const bright = pulse ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(this._phase)) : 1;

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
            if (g._r !== R || pulse) {   // pulse redraws every frame for the breathing alpha
              this.drawRing(g, R, bright);
              g._r = R;
              changed = changed || pulse;
            }
            if (scale !== 1 && node.text && node.text.style) {
              const t = node.text;
              const cur = t.style.fontSize || 0;
              // When the size isn't our last applied value, the renderer has
              // (re)set the natural size (e.g. on zoom) — recapture it so the
              // multiplier stays proportional to each node's own label.
              if (t._gttsFont === undefined || Math.abs(cur - t._gttsFont) > 0.01) {
                t._gttsNatural = cur;
              }
              const target = t._gttsNatural * scale;
              if (Math.abs(cur - target) > 0.01) {
                t.style.fontSize = target;
                t._gttsFont = target;
                changed = true;
              }
            }
            active.add(node.id);
          }
        }

        // Spotlight: fade non-matching nodes/labels so the matches stand out.
        if (q && this.settings.dimNonMatches) {
          const dim = this.settings.dimOpacity;
          for (const node of list) {
            if (node && this.setNodeAlpha(node, matches(node) ? 1 : dim)) {
              changed = true;
            }
          }
        } else if (this.restoreDim(view)) {
          changed = true;
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

  // Restore a node label we enlarged. Rather than guessing the previous size
  // (which drifts with zoom), flag the node so the renderer recomputes its
  // natural font size on the next render.
  unscaleText(node) {
    const text = node && node.text;
    if (!text || text._gttsFont === undefined) {
      return;
    }
    node.fontDirty = true;
    delete text._gttsFont;
    delete text._gttsNatural;
  }

  // Set a node's circle + label opacity (persists — the renderer doesn't
  // overwrite these, unlike fadeAlpha). Returns true if anything changed.
  setNodeAlpha(node, a) {
    let changed = false;
    // The node circle is drawn from node.color.a in the renderer's batched mesh
    // (its Graphics.alpha / fadeAlpha don't affect the draw). The label is a real
    // Text object, so its own alpha works.
    if (node.color && node.color.a !== a) {
      node.color.a = a;
      changed = true;
    }
    if (node.text && node.text.alpha !== a) {
      node.text.alpha = a;
      changed = true;
    }
    if (a < 1) {
      node._gttsDimmed = true;
    } else {
      delete node._gttsDimmed;
    }
    return changed;
  }

  // Restore full opacity to every node we dimmed. Returns true if anything changed.
  restoreDim(view) {
    let changed = false;
    for (const node of this.nodeList(view.renderer)) {
      if (node && node._gttsDimmed && this.setNodeAlpha(node, 1)) {
        changed = true;
      }
    }
    return changed;
  }

  // Reset every enlarged label (used when the size multiplier returns to 1).
  resetAllScales() {
    for (const view of this.states.keys()) {
      let changed = false;
      for (const node of this.nodeList(view.renderer)) {
        if (node && node.text && node.text._gttsFont !== undefined) {
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
    this.restoreDim(view);
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
      .setName("Soft glow")
      .setDesc("Draw the ring as a soft glow (layered) instead of a crisp stroke.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.glow).onChange(async (v) => {
          this.plugin.settings.glow = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.redrawAllRings();
        })
      );

    new Setting(containerEl)
      .setName("Pulse")
      .setDesc("Gently animate the ring so matches breathe.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.pulse).onChange(async (v) => {
          this.plugin.settings.pulse = v;
          await this.plugin.saveData(this.plugin.settings);
          this.plugin.redrawAllRings();
        })
      );

    new Setting(containerEl)
      .setName("Dim non-matches")
      .setDesc("Fade non-matching nodes so the matches stand out (spotlight).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.dimNonMatches).onChange(async (v) => {
          this.plugin.settings.dimNonMatches = v;
          await this.plugin.saveData(this.plugin.settings);
          if (!v) {
            for (const view of this.plugin.states.keys()) {
              this.plugin.restoreDim(view);
              if (view.renderer && view.renderer.changed) view.renderer.changed();
            }
          }
        })
      );

    new Setting(containerEl)
      .setName("Dim strength")
      .setDesc("Opacity of dimmed (non-matching) nodes — lower is dimmer.")
      .addSlider((s) =>
        s.setLimits(0.05, 0.6, 0.05).setValue(this.plugin.settings.dimOpacity).setDynamicTooltip().onChange(async (v) => {
          this.plugin.settings.dimOpacity = v;
          await this.plugin.saveData(this.plugin.settings);
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
