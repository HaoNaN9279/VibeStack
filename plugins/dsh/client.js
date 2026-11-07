// VibeStack browser half for DeepSeek Harness.
//
// Shipped as a prebuilt client bundle: a factory registered on the module
// loader. Only React and react-dom (platform-seeded modules) are required, so
// no build step is involved.
//
// The picker occupies `conversation.input.left` — the compact control strip on
// the bottom-left of the composer — and opens its own menu above that strip.
// The menu is portalled to `document.body` and positioned from the trigger's
// viewport rect, so it is never clipped by the composer card.
//
// It renders only while the session runs the `vibestack` agent preset.
// Selecting an agent runs the mode's `/vibestack-agent <name>` command; the
// command log event is what the `vibestack` projection folds, so the choice
// survives a restart without any plugin-owned session event type.
window.__ModuleLoader__.load({
  id: "dsh-vibestack",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const reactDom = require("react-dom");
    const h = react.createElement;

    /** Services this client plugin consumes. */
    const inject = ["slots", "remote", "remote.commands"];

    /**
     * The client context that owns the slot registration.
     *
     * Two Loader entries reference this package (the root UI row and the preset
     * row); the first one to mount owns the slot and later mounts are no-ops.
     */
    let owner = null;

    /** Menu ids stay unique per mounted picker (single React instance, no useId dependency). */
    let pickerSeq = 0;

    const styles = {
      root: { position: "relative", display: "inline-flex", alignItems: "center", maxWidth: "100%" },
      trigger: {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        height: "28px",
        maxWidth: "200px",
        padding: "0 8px",
        borderRadius: "var(--dsw-radius-sm, 6px)",
        border: "none",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, inherit)",
        fontFamily: "inherit",
        fontSize: "13px",
        fontWeight: 500,
        lineHeight: "20px",
        whiteSpace: "nowrap",
        cursor: "pointer"
      },
      triggerOpen: { background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))" },
      triggerDisabled: { opacity: 0.6, cursor: "default" },
      glyph: { flex: "none", fontSize: "10px", lineHeight: "1", opacity: 0.8 },
      label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
      placeholder: { color: "var(--dsw-alias-label-tertiary, inherit)", fontWeight: 400 },
      caret: { flex: "none", fontSize: "9px", lineHeight: "1", opacity: 0.7 },
      menu: {
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        boxSizing: "border-box",
        overflowY: "auto",
        overscrollBehavior: "contain",
        padding: "4px",
        borderRadius: "var(--dsw-radius-lg, 12px)",
        border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
        background: "var(--dsw-specific-menu, var(--dsw-specific-input-major, #1f1f1f))",
        backdropFilter: "blur(40px) saturate(150%)",
        WebkitBackdropFilter: "blur(40px) saturate(150%)",
        boxShadow: "var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,0.28))",
        zIndex: 1100
      },
      menuHeader: {
        display: "flex",
        flexDirection: "column",
        gap: "1px",
        padding: "5px 8px",
        marginBottom: "2px",
        borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.18))"
      },
      menuTitle: {
        fontSize: "11px",
        fontWeight: 600,
        letterSpacing: "0.02em",
        color: "var(--dsw-alias-label-caption, inherit)"
      },
      menuHint: { fontSize: "11px", lineHeight: "15px", color: "var(--dsw-alias-label-tertiary, inherit)" },
      item: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "6px 8px",
        borderRadius: "var(--dsw-radius-sm, 6px)",
        border: "none",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
        textAlign: "left",
        fontFamily: "inherit",
        fontSize: "13px",
        cursor: "pointer"
      },
      itemActive: { background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.16))" },
      check: {
        flex: "none",
        width: "14px",
        fontSize: "12px",
        lineHeight: "1",
        color: "var(--dsw-alias-state-business-primary, inherit)"
      },
      itemBody: { display: "flex", flexDirection: "column", gap: "1px", minWidth: 0, flex: "1 1 auto" },
      itemName: { fontWeight: 500, lineHeight: "18px" },
      itemGroup: {
        marginLeft: "6px",
        fontSize: "10px",
        fontWeight: 400,
        lineHeight: "14px",
        padding: "0 4px",
        borderRadius: "4px",
        color: "var(--dsw-alias-label-tertiary, inherit)",
        background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.14))"
      },
      itemDesc: {
        fontSize: "11px",
        lineHeight: "15px",
        color: "var(--dsw-alias-label-caption, inherit)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      },
      empty: {
        padding: "6px 8px 8px",
        fontSize: "12px",
        color: "var(--dsw-alias-label-tertiary, inherit)"
      }
    };

    /**
     * Place the portal menu against the trigger: above it when there is room,
     * otherwise below, always inside the viewport.
     * @param {HTMLElement} trigger - the picker button.
     * @returns {{position: string, left: string, top?: string, bottom?: string, width: string, maxHeight: string}} fixed style.
     */
    function placeMenu(trigger) {
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const gap = 8;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(320, Math.max(248, Math.round(rect.width) + 40));
      const left = Math.min(
        Math.max(margin, Math.round(rect.left) - 4),
        Math.max(margin, viewportWidth - width - margin)
      );
      const spaceAbove = Math.round(rect.top) - gap - margin;
      const spaceBelow = viewportHeight - Math.round(rect.bottom) - gap - margin;
      const upward = spaceAbove >= 180 || spaceAbove >= spaceBelow;
      const maxHeight = Math.max(120, Math.min(320, upward ? spaceAbove : spaceBelow));
      const style = {
        position: "fixed",
        left: left + "px",
        width: width + "px",
        maxHeight: maxHeight + "px"
      };
      if (upward) style.bottom = viewportHeight - Math.round(rect.top) + gap + "px";
      else style.top = Math.round(rect.bottom) + gap + "px";
      return style;
    }

    /** Exact Fetch route owned by the host core row. */
    const LAYERS_PATH = "/api/vibestack/models";

    /**
     * Read the model-layer document from the host route.
     * @returns {Promise<{layers: object[], default: string | null, warnings?: string[]}>} payload.
     */
    async function readLayerConfig() {
      const response = await fetch(LAYERS_PATH, { credentials: "same-origin", cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message ?? payload.code ?? `HTTP ${response.status}`);
      }
      return payload;
    }

    /**
     * Write a model-layer document through the host route.
     * @param {{layers: object[], default: string | null}} document - proposed document.
     * @returns {Promise<object>} payload.
     */
    async function writeLayerConfig(document) {
      const response = await fetch(LAYERS_PATH, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(document)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const detail = payload.message ?? ((payload.warnings ?? []).join("; ") || `HTTP ${response.status}`);
        throw new Error(detail);
      }
      return payload;
    }

    /**
     * Derive the active layer from a session's model projection.
     * @param {object[]} layers - configured layers.
     * @param {object | undefined} selection - `{provider, model, reasoningEffort?}`.
     * @returns {object | undefined} matching layer.
     */
    function activeLayer(layers, selection) {
      if (!selection || typeof selection !== "object") return undefined;
      return layers.find(
        (layer) =>
          layer.provider === selection.provider &&
          layer.model === selection.model &&
          (layer.reasoningEffort === undefined || layer.reasoningEffort === selection.reasoningEffort)
      );
    }

    /**
     * Additive model-layer menu in the composer control strip.
     * @param {{useProjection: Function, onApply: (id: string) => Promise<void>}} props - slot props.
     * @returns {object | null} react element or null outside the mode.
     */
    function LayerPicker(props) {
      const preset = props.useProjection("agentPreset");
      const projection = props.useProjection("modelSelection");
      const selection = projection && (projection.next ?? projection.current ?? projection);
      const [layers, setLayers] = react.useState([]);
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [error, setError] = react.useState(null);
      const [active, setActive] = react.useState(0);
      const [pos, setPos] = react.useState(null);
      const rootRef = react.useRef(null);
      const triggerRef = react.useRef(null);
      const menuRef = react.useRef(null);
      const idRef = react.useRef(null);
      const restoreFocus = react.useRef(false);

      if (idRef.current === null) {
        pickerSeq += 1;
        idRef.current = "vibestack-layer-menu-" + pickerSeq;
      }

      const visible = preset === "vibestack";
      const current = activeLayer(layers, selection);
      const label = current ? current.label : selection ? "未映射" : "模型层";

      const load = react.useCallback(async () => {
        try {
          const payload = await readLayerConfig();
          setLayers(Array.isArray(payload.layers) ? payload.layers : []);
          setError(null);
        } catch (failure) {
          setLayers([]);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }, []);

      react.useEffect(() => {
        if (visible) void load();
      }, [visible, load]);

      const measure = react.useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        setPos(placeMenu(trigger));
      }, []);

      react.useEffect(() => {
        if (!open) return;
        const index = current === undefined ? 0 : layers.findIndex((layer) => layer.id === current.id);
        setActive(index < 0 ? 0 : index);
      }, [open, current, layers.length]);

      react.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        measure();
        const onViewportChange = () => measure();
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
          window.removeEventListener("resize", onViewportChange);
          window.removeEventListener("scroll", onViewportChange, true);
        };
      }, [open, measure]);

      react.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          const root = rootRef.current;
          const menu = menuRef.current;
          if (root && root.contains(target)) return;
          if (menu && menu.contains(target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          setOpen(false);
          triggerRef.current?.focus?.();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("mousedown", onPointerDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      react.useEffect(() => {
        if (busy) {
          setOpen(false);
          return;
        }
        if (!restoreFocus.current) return;
        restoreFocus.current = false;
        triggerRef.current?.focus?.();
      }, [busy]);

      if (!visible) return null;

      const choose = async (layer) => {
        if (busy || (current && current.id === layer.id)) {
          setOpen(false);
          return;
        }
        restoreFocus.current = true;
        setBusy(true);
        try {
          await props.onApply(layer.id);
        } catch (failure) {
          console.warn("[vibestack] layer selection failed", failure);
        } finally {
          setBusy(false);
        }
      };

      const onKeyDown = (event) => {
        if (!open || layers.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => (index + 1) % layers.length);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => (index - 1 + layers.length) % layers.length);
        } else if (event.key === "Enter" || event.key === " ") {
          const layer = layers[active];
          if (layer === undefined) return;
          event.preventDefault();
          void choose(layer);
        }
      };

      const trigger = h(
        "button",
        {
          type: "button",
          ref: triggerRef,
          style: open
            ? Object.assign({}, styles.trigger, styles.triggerOpen)
            : busy
              ? Object.assign({}, styles.trigger, styles.triggerDisabled)
              : styles.trigger,
          title: current ? `VibeStack 模型层：${current.id}` : "VibeStack 模型层：未映射",
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? idRef.current : undefined,
          "aria-label": `VibeStack 模型层：${label}`,
          "aria-busy": busy,
          disabled: busy,
          onClick: () => {
            if (open) {
              setOpen(false);
              return;
            }
            measure();
            setOpen(true);
            void load();
          }
        },
        h("span", { style: styles.glyph, "aria-hidden": true }, "◈"),
        h("span", { style: selection ? styles.label : Object.assign({}, styles.label, styles.placeholder) }, busy ? "切换中…" : label),
        h("span", { style: styles.caret, "aria-hidden": true }, "▾")
      );

      const menu =
        open && pos !== null
          ? reactDom.createPortal(
              h(
                "div",
                {
                  ref: menuRef,
                  id: idRef.current,
                  role: "menu",
                  "aria-label": "VibeStack 模型层",
                  style: Object.assign({}, styles.menu, pos)
                },
                h(
                  "div",
                  { style: styles.menuHeader },
                  h("span", { style: styles.menuTitle }, "VibeStack · 模型层"),
                  h("span", { style: styles.menuHint }, "用户级路由；只影响会话模型，不改变权限或工具")
                ),
                error ? h("span", { style: styles.empty }, error) : null,
                !error && layers.length === 0
                  ? h("span", { style: styles.empty }, "未配置模型层（在设置中新增）")
                  : layers.map((layer, index) =>
                      h(
                        "button",
                        {
                          key: layer.id,
                          type: "button",
                          role: "menuitemradio",
                          "aria-checked": current !== undefined && current.id === layer.id,
                          tabIndex: -1,
                          style: index === active ? Object.assign({}, styles.item, styles.itemActive) : styles.item,
                          onMouseEnter: () => setActive(index),
                          onClick: () => void choose(layer)
                        },
                        h("span", { style: styles.check, "aria-hidden": true }, current && current.id === layer.id ? "✓" : ""),
                        h(
                          "span",
                          { style: styles.itemBody },
                          h("span", { style: styles.itemName }, layer.label, h("span", { style: styles.itemGroup }, layer.id)),
                          h("span", { style: styles.itemDesc }, `${layer.provider}/${layer.model}${layer.reasoningEffort ? " · " + layer.reasoningEffort : ""}`)
                        )
                      )
                    )
              ),
              document.body
            )
          : null;

      return h(
        react.Fragment,
        null,
        h("div", { ref: rootRef, style: styles.root, onKeyDown }, trigger),
        menu
      );
    }

    /**
     * Settings page for model layers.
     * @param {{ctx?: object}} props - settings section props.
     * @returns {object} react element.
     */
    function LayerSettings(props) {
      const [layers, setLayers] = react.useState([]);
      const [defaultId, setDefaultId] = react.useState(null);
      const [draft, setDraft] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const [message, setMessage] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [catalog, setCatalog] = react.useState(null);

      const load = react.useCallback(async () => {
        try {
          const payload = await readLayerConfig();
          setLayers(Array.isArray(payload.layers) ? payload.layers : []);
          setDefaultId(typeof payload.default === "string" ? payload.default : null);
          setCatalog(payload.catalog ?? null);
          setError(null);
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      }, []);

      react.useEffect(() => {
        void load();
      }, [load]);

      const save = async () => {
        if (draft === null) return;
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
          const originalId = draft._originalId ?? draft.id;
          const next = layers.filter((layer) => layer.id !== originalId).concat([draft]);
          const nextDefault = defaultId === originalId ? draft.id : defaultId;
          const payload = await writeLayerConfig({ layers: next, default: nextDefault });
          setLayers(Array.isArray(payload.layers) ? payload.layers : next);
          setDefaultId(typeof payload.default === "string" ? payload.default : null);
          setDraft(null);
          setMessage("已保存");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      const publish = async (nextLayers, nextDefault) => {
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
          const payload = await writeLayerConfig({ layers: nextLayers, default: nextDefault });
          setLayers(Array.isArray(payload.layers) ? payload.layers : nextLayers);
          setDefaultId(typeof payload.default === "string" ? payload.default : null);
          setMessage("已保存");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      const remove = (id) => publish(layers.filter((layer) => layer.id !== id), defaultId === id ? null : defaultId);
      const makeDefault = (id) => publish(layers, defaultId === id ? null : id);

      const field = (key, placeholder, value, onInput, type = "text") =>
        h("input", {
          type,
          value: value ?? "",
          placeholder,
          onChange: (event) => onInput(event.target.value),
          style: {
            boxSizing: "border-box",
            width: "100%",
            padding: "7px 9px",
            borderRadius: "var(--dsw-radius-sm, 6px)",
            border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
            background: "transparent",
            color: "inherit",
            fontFamily: "inherit",
            fontSize: "13px"
          }
        });

      const rowStyle = {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 0",
        borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.14))"
      };

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0 20px" } },
        h("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-tertiary, inherit)", lineHeight: "19px" } },
          "模型层是用户级路由别名。能力组只写 model: <layer>；provider / model / effort 留在本机配置，不进入仓库。"),
        error ? h("div", { style: { color: "var(--dsw-alias-state-error-primary, #d33)", fontSize: "12px" } }, error) : null,
        message ? h("div", { style: { color: "var(--dsw-alias-state-success-primary, #2a7)", fontSize: "12px" } }, message) : null,
        catalog && !catalog.error
          ? h("div", { style: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, inherit)" } },
              `路由检测：${(catalog.available ?? []).length} 可用，${(catalog.unroutable ?? []).length} 不可用` +
                ((catalog.unroutable ?? []).length === 0
                  ? ""
                  : " · " + (catalog.unroutable ?? []).map((layer) => `${layer.id}: ${layer.reason}`).join("; ")))
          : null,
        layers.length === 0
          ? h("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-tertiary, inherit)" } }, "还没有模型层。")
          : h("div", null, layers.map((layer) =>
              h("div", { key: layer.id, style: rowStyle },
                h("button", {
                  type: "button",
                  title: "设为默认层",
                  onClick: () => void makeDefault(layer.id),
                  style: {
                    flex: "none",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.4))",
                    background: defaultId === layer.id ? "var(--dsw-alias-state-business-primary, #4a7)" : "transparent",
                    color: "transparent",
                    cursor: "pointer"
                  }
                }, "•"),
                h("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" } },
                  h("span", { style: { fontSize: "13px", fontWeight: 500 } }, `${layer.label} (${layer.id})`),
                  h("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, inherit)" } },
                    `${layer.provider}/${layer.model}${layer.reasoningEffort ? " · " + layer.reasoningEffort : ""}${defaultId === layer.id ? " · 默认" : ""}`)
                ),
                h("button", { type: "button", onClick: () => setDraft({ ...layer, _originalId: layer.id }), style: smallButton }, "编辑"),
                h("button", { type: "button", onClick: () => void remove(layer.id), style: smallButton }, "删除")
              )
            )),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", { type: "button", onClick: () => setDraft({ id: "", label: "", provider: "", model: "", reasoningEffort: "", description: "" }), style: primaryButton }, "新增模型层"),
          h("button", { type: "button", onClick: () => void load(), style: smallButton }, "检测路由 / 重新读取")
        ),
        draft === null
          ? null
          : h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: "var(--dsw-radius-md, 10px)", border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))" } },
              h("div", { style: { fontSize: "12px", fontWeight: 600 } }, "编辑模型层"),
              field("id", "id（小写 kebab，如 strong）", draft.id, (value) => setDraft({ ...draft, id: value })),
              field("label", "显示名（如 深度）", draft.label, (value) => setDraft({ ...draft, label: value })),
              field("provider", "provider（如 deepseek-account）", draft.provider, (value) => setDraft({ ...draft, provider: value })),
              field("model", "model（如 deepseek-pro）", draft.model, (value) => setDraft({ ...draft, model: value })),
              field("reasoningEffort", "reasoningEffort（可选）", draft.reasoningEffort, (value) => setDraft({ ...draft, reasoningEffort: value })),
              field("description", "说明（可选）", draft.description, (value) => setDraft({ ...draft, description: value })),
              h("div", { style: { display: "flex", gap: "8px" } },
                h("button", { type: "button", disabled: busy, onClick: () => void save(), style: primaryButton }, busy ? "保存中…" : "保存"),
                h("button", { type: "button", disabled: busy, onClick: () => setDraft(null), style: smallButton }, "取消")
              )
            )
      );
    }

    /**
     * Opt-in replacement for the composer model seat.
     *
     * Only registered when `modelSelector: replace` is configured. For
     * VibeStack sessions it lists layers; for other modes it falls back to the
     * live native catalog so replacing the seat never removes model choice.
     * @param {{useProjection: Function, available: boolean, directory: object, load: Function, select: Function}} props - slot props.
     * @returns {object | null} react element or null for addressed subagents.
     */
    function ModelSeat(props) {
      const preset = props.useProjection("agentPreset");
      const subscribe = react.useCallback(
        (callback) => (props.directory ? props.directory.subscribe(callback) : () => {}),
        [props.directory]
      );
      const getSnapshot = react.useCallback(
        () => (props.directory ? props.directory.getSnapshot() : null),
        [props.directory]
      );
      const snapshot = react.useSyncExternalStore(subscribe, getSnapshot);
      const [layers, setLayers] = react.useState([]);
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [active, setActive] = react.useState(0);
      const [pos, setPos] = react.useState(null);
      const triggerRef = react.useRef(null);
      const menuRef = react.useRef(null);
      const idRef = react.useRef(null);
      const restoreFocus = react.useRef(false);

      if (idRef.current === null) {
        pickerSeq += 1;
        idRef.current = "vibestack-model-menu-" + pickerSeq;
      }

      const isVibeStack = preset === "vibestack";
      const current = snapshot && snapshot.current ? snapshot.current : null;
      const groups = snapshot && Array.isArray(snapshot.groups) ? snapshot.groups : [];
      const layer = isVibeStack ? activeLayer(layers, current) : undefined;

      react.useEffect(() => {
        if (!props.available) return;
        props.load?.();
        if (!isVibeStack) return;
        let alive = true;
        readLayerConfig()
          .then((payload) => {
            if (alive) setLayers(Array.isArray(payload.layers) ? payload.layers : []);
          })
          .catch(() => {
            if (alive) setLayers([]);
          });
        return () => {
          alive = false;
        };
      }, [props.available, isVibeStack, props.load]);

      const measure = react.useCallback(() => {
        if (triggerRef.current) setPos(placeMenu(triggerRef.current));
      }, []);

      react.useEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        measure();
        const onViewportChange = () => measure();
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
          window.removeEventListener("resize", onViewportChange);
          window.removeEventListener("scroll", onViewportChange, true);
        };
      }, [open, measure]);

      react.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          if (menuRef.current && menuRef.current.contains(target)) return;
          if (triggerRef.current && triggerRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKey = (event) => {
          if (event.key !== "Escape") return;
          setOpen(false);
          triggerRef.current?.focus?.();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
          document.removeEventListener("mousedown", onPointerDown);
          document.removeEventListener("keydown", onKey);
        };
      }, [open]);

      react.useEffect(() => {
        if (busy) {
          setOpen(false);
          return;
        }
        if (!restoreFocus.current) return;
        restoreFocus.current = false;
        triggerRef.current?.focus?.();
      }, [busy]);

      if (!props.available) return null;

      const nativeNames = new Map();
      for (const group of groups) {
        for (const model of group.models ?? []) nativeNames.set(`${group.id}/${model.id}`, model.name);
      }
      const nativeOptions = groups.flatMap((group) =>
        (group.models ?? []).map((model) => ({
          key: `${group.id}/${model.id}`,
          label: model.name,
          detail: isVibeStack ? `跟随 DSH · ${group.name}` : group.name,
          selected: layer === undefined && current !== null && current.provider === group.id && current.model === model.id,
          selection: { provider: group.id, model: model.id }
        }))
      );
      const layerOptions = layers.map((entry) => ({
        key: entry.id,
        label: entry.label,
        detail: `${entry.provider}/${entry.model}${entry.reasoningEffort ? " · " + entry.reasoningEffort : ""}`,
        selected: layer !== undefined && layer.id === entry.id,
        selection: {
          provider: entry.provider,
          model: entry.model,
          ...(entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort })
        }
      }));
      const options = isVibeStack ? layerOptions.concat(nativeOptions) : nativeOptions;
      const nativeName = current ? nativeNames.get(`${current.provider}/${current.model}`) : undefined;
      const label = isVibeStack
        ? layer?.label ?? nativeName ?? (current ? "未映射" : "模型层")
        : nativeName ?? current?.model ?? "选择模型";

      const choose = async (option) => {
        if (busy || option.selected) {
          setOpen(false);
          return;
        }
        restoreFocus.current = true;
        setBusy(true);
        try {
          const result = await props.select(option.selection);
          if (result && result.ok === false) {
            throw new Error(`${result.error?.code ?? "model-unavailable"}: ${result.error?.message ?? ""}`);
          }
        } catch (failure) {
          console.warn("[vibestack] model selection failed", failure);
        } finally {
          setBusy(false);
        }
      };

      const onKeyDown = (event) => {
        if (!open || options.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => (index + 1) % options.length);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => (index - 1 + options.length) % options.length);
        } else if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const option = options[active];
          if (option !== undefined) void choose(option);
        }
      };

      const trigger = h(
        "button",
        {
          type: "button",
          ref: triggerRef,
          style: open
            ? Object.assign({}, styles.trigger, styles.triggerOpen)
            : busy
              ? Object.assign({}, styles.trigger, styles.triggerDisabled)
              : styles.trigger,
          title: isVibeStack ? `VibeStack 模型层：${label}` : `模型：${label}`,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? idRef.current : undefined,
          "aria-label": label,
          "aria-busy": busy,
          disabled: busy,
          onClick: () => {
            if (open) {
              setOpen(false);
              return;
            }
            measure();
            setOpen(true);
          }
        },
        h("span", { style: styles.glyph, "aria-hidden": true }, "◇"),
        h("span", { style: styles.label }, busy ? "切换中…" : label),
        h("span", { style: styles.caret, "aria-hidden": true }, "▾")
      );

      const menu =
        open && pos !== null
          ? reactDom.createPortal(
              h(
                "div",
                {
                  ref: menuRef,
                  id: idRef.current,
                  role: "menu",
                  "aria-label": isVibeStack ? "VibeStack 模型层" : "模型",
                  style: Object.assign({}, styles.menu, pos)
                },
                h(
                  "div",
                  { style: styles.menuHeader },
                  h("span", { style: styles.menuTitle }, isVibeStack ? "VibeStack · 模型层" : "模型"),
                  h("span", { style: styles.menuHint }, isVibeStack ? "用户级路由；不改变权限或工具" : "跟随 DSH 模型目录")
                ),
                options.length === 0
                  ? h("span", { style: styles.empty }, isVibeStack ? "未配置模型层" : "没有可用模型")
                  : options.map((option, index) =>
                      h(
                        "button",
                        {
                          key: option.key,
                          type: "button",
                          role: "menuitemradio",
                          "aria-checked": option.selected,
                          tabIndex: -1,
                          style: index === active ? Object.assign({}, styles.item, styles.itemActive) : styles.item,
                          onMouseEnter: () => setActive(index),
                          onClick: () => void choose(option)
                        },
                        h("span", { style: styles.check, "aria-hidden": true }, option.selected ? "✓" : ""),
                        h(
                          "span",
                          { style: styles.itemBody },
                          h("span", { style: styles.itemName }, option.label),
                          h("span", { style: styles.itemDesc }, option.detail)
                        )
                      )
                    )
              ),
              document.body
            )
          : null;

      return h(
        react.Fragment,
        null,
        h("div", { style: styles.root, onKeyDown }, trigger),
        menu
      );
    }

    const smallButton = {
      flex: "none",
      padding: "5px 9px",
      borderRadius: "var(--dsw-radius-sm, 6px)",
      border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
      background: "transparent",
      color: "inherit",
      fontFamily: "inherit",
      fontSize: "12px",
      cursor: "pointer"
    };
    const primaryButton = Object.assign({}, smallButton, {
      background: "var(--dsw-alias-state-business-primary, #3a6df0)",
      borderColor: "transparent",
      color: "#fff"
    });

    /**
     * Bottom-left agent menu for the VibeStack mode.
     * @param {{useProjection: Function, onSelect: (name: string) => Promise<void>}} props - slot props.
     * @returns {object | null} react element or null outside the mode.
     */
    function AgentPicker(props) {
      const state = props.useProjection("vibestack");
      const preset = props.useProjection("agentPreset");
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [active, setActive] = react.useState(0);
      const [pos, setPos] = react.useState(null);
      const rootRef = react.useRef(null);
      const triggerRef = react.useRef(null);
      const menuRef = react.useRef(null);
      const idRef = react.useRef(null);
      const restoreFocus = react.useRef(false);

      if (idRef.current === null) {
        pickerSeq += 1;
        idRef.current = "vibestack-agent-menu-" + pickerSeq;
      }

      const roster = state && Array.isArray(state.agents) ? state.agents : [];
      // The left menu lists every Agent in Core + the current workspace union,
      // including subagent-only definitions.
      const agents = roster.filter((agent) => agent && typeof agent.name === "string");
      const selected =
        state && typeof state.selected === "string" && agents.some((agent) => agent.name === state.selected)
          ? state.selected
          : null;
      const visible = preset === "vibestack" && agents.length > 0;

      const measure = react.useCallback(() => {
        const trigger = triggerRef.current;
        if (!trigger) return;
        setPos(placeMenu(trigger));
      }, []);

      // Keep the highlighted row on the current persona whenever the menu opens.
      react.useEffect(() => {
        if (!open) return;
        const index = selected === null ? 0 : agents.findIndex((agent) => agent.name === selected);
        setActive(index < 0 ? 0 : index);
      }, [open, selected, agents.length]);

      // Follow the trigger while the composer or the window changes size.
      react.useLayoutEffect(() => {
        if (!open) {
          setPos(null);
          return undefined;
        }
        measure();
        const onViewportChange = () => measure();
        window.addEventListener("resize", onViewportChange);
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
          window.removeEventListener("resize", onViewportChange);
          window.removeEventListener("scroll", onViewportChange, true);
        };
      }, [open, measure]);

      // Outside click / Escape closes the menu (the portal is outside the root).
      react.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const target = event.target;
          if (!(target instanceof Node)) return;
          const root = rootRef.current;
          const menu = menuRef.current;
          if (root && root.contains(target)) return;
          if (menu && menu.contains(target)) return;
          setOpen(false);
        };
        const onDocumentKeyDown = (event) => {
          if (event.key !== "Escape") return;
          setOpen(false);
          const trigger = triggerRef.current;
          if (trigger && typeof trigger.focus === "function") trigger.focus();
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onDocumentKeyDown);
        return () => {
          document.removeEventListener("mousedown", onPointerDown);
          document.removeEventListener("keydown", onDocumentKeyDown);
        };
      }, [open]);

      // A selection closes the menu; the trigger keeps the pending state until
      // the host acknowledges the command, then takes focus back.
      react.useEffect(() => {
        if (busy) {
          setOpen(false);
          return;
        }
        if (!restoreFocus.current) return;
        restoreFocus.current = false;
        const trigger = triggerRef.current;
        if (trigger && typeof trigger.focus === "function") trigger.focus();
      }, [busy]);

      if (!visible) return null;

      const choose = async (name) => {
        if (busy || name === selected) {
          setOpen(false);
          return;
        }
        restoreFocus.current = true;
        setBusy(true);
        try {
          await props.onSelect(name);
        } catch (error) {
          console.warn("[vibestack] agent selection failed", error);
        } finally {
          setBusy(false);
        }
      };

      const onKeyDown = (event) => {
        if (!open || agents.length === 0) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActive((index) => (index + 1) % agents.length);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setActive((index) => (index - 1 + agents.length) % agents.length);
        } else if (event.key === "Home") {
          event.preventDefault();
          setActive(0);
        } else if (event.key === "End") {
          event.preventDefault();
          setActive(agents.length - 1);
        } else if (event.key === "Enter" || event.key === " ") {
          const agent = agents[active];
          if (agent === undefined) return;
          event.preventDefault();
          void choose(agent.name);
        }
      };

      const label = selected === null ? "选择 Agent" : selected;

      const trigger = h(
        "button",
        {
          type: "button",
          ref: triggerRef,
          style: open
            ? Object.assign({}, styles.trigger, styles.triggerOpen)
            : busy
              ? Object.assign({}, styles.trigger, styles.triggerDisabled)
              : styles.trigger,
          title:
            selected === null
              ? "VibeStack Agent：未选择人设，点击选择"
              : `VibeStack Agent：${selected}（本会话人设）`,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? idRef.current : undefined,
          "aria-label": `VibeStack Agent：${label}`,
          "aria-busy": busy,
          disabled: busy,
          onClick: () => {
            if (open) {
              setOpen(false);
              return;
            }
            measure();
            setOpen(true);
          }
        },
        h("span", { style: styles.glyph, "aria-hidden": true }, "◆"),
        h(
          "span",
          { style: selected === null ? Object.assign({}, styles.label, styles.placeholder) : styles.label },
          busy ? "切换中…" : label
        ),
        h("span", { style: styles.caret, "aria-hidden": true }, "▾")
      );

      const menu =
        open && pos !== null
          ? reactDom.createPortal(
              h(
                "div",
                {
                  ref: menuRef,
                  id: idRef.current,
                  role: "menu",
                  "aria-label": "VibeStack Agent",
                  style: Object.assign({}, styles.menu, pos)
                },
                h(
                  "div",
                  { style: styles.menuHeader },
                  h("span", { style: styles.menuTitle }, "VibeStack · Agent"),
                  h("span", { style: styles.menuHint }, "Core + 当前工作区能力组的并集；切换只影响本会话人设")
                ),
                agents.map((agent, index) =>
                  h(
                    "button",
                    {
                      key: agent.name,
                      type: "button",
                      role: "menuitemradio",
                      "aria-checked": agent.name === selected,
                      tabIndex: -1,
                      style: index === active ? Object.assign({}, styles.item, styles.itemActive) : styles.item,
                      onMouseEnter: () => setActive(index),
                      onClick: () => void choose(agent.name)
                    },
                    h("span", { style: styles.check, "aria-hidden": true }, agent.name === selected ? "✓" : ""),
                    h(
                      "span",
                      { style: styles.itemBody },
                      h(
                        "span",
                        { style: styles.itemName },
                        agent.name,
                        agent.group ? h("span", { style: styles.itemGroup }, agent.group) : null
                      ),
                      agent.description ? h("span", { style: styles.itemDesc }, agent.description) : null
                    )
                  )
                )
              ),
              document.body
            )
          : null;

      return h(
        react.Fragment,
        null,
        h(
          "div",
          {
            ref: rootRef,
            style: styles.root,
            "data-vibestack-agent-picker": selected === null ? "" : selected,
            onKeyDown
          },
          trigger
        ),
        menu
      );
    }

    /**
     * Client plugin body.
     * @param {Record<string, unknown>} ctx - client context.
     * @returns {void}
     */
    function apply(ctx) {
      if (owner !== null) return;
      owner = ctx;
      ctx.effect(() => () => {
        if (owner === ctx) owner = null;
      }, "vibestack: release the agent picker");
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          {
            name: "conversation.input.left",
            id: "vibestack-agent",
            order: 5,
            inject: (sessionId) => ({
              onSelect: async (name) => {
                const result = await ctx.remote.commands.execute(
                  sessionId,
                  "/vibestack-agent " + name,
                  []
                );
                if (result && result.ok === false) {
                  throw new Error(
                    `vibestack: ${result.error?.code ?? "command-failed"}: ${result.error?.message ?? ""}`
                  );
                }
              }
            })
          },
          AgentPicker
        )
      );
      // The model-layer selector lives in the right-hand model seat, not in the
      // left strip: that strip belongs to the Agent picker.
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "vibestack-models",
            order: 40,
            label: () => "VibeStack 模型层"
          },
          LayerSettings
        )
      );
      // Optional full replacement: only when the core row reports
      // `modelSelector: replace`. The component falls back to the live native
      // catalog outside VibeStack sessions, so the model seat never goes blank.
      void readLayerConfig()
        .then((payload) => {
          if (payload.selector === "additive") {
            ctx.slots.inject("conversation.input.left", () =>
              ctx.slots.register(
                {
                  name: "conversation.input.left",
                  id: "vibestack-layer",
                  order: 6,
                  inject: (sessionId) => ({
                    onApply: async (id) => {
                      const result = await ctx.remote.commands.execute(
                        sessionId,
                        "/vibestack-layer " + id,
                        []
                      );
                      if (result && result.ok === false) {
                        throw new Error(
                          `vibestack: ${result.error?.code ?? "command-failed"}: ${result.error?.message ?? ""}`
                        );
                      }
                    }
                  })
                },
                LayerPicker
              )
            );
            return;
          }
          if (payload.selector !== "replace") return;
          if (typeof ctx.inject !== "function") return;
          ctx.inject(["slots", "modelDirectories", "sessions"], (scope) => {
            try {
              const models = scope.modelDirectories;
              const sessions = scope.sessions;
              scope.slots.inject("conversation.input.model", () =>
                scope.slots.register(
                  {
                    name: "conversation.input.model",
                    priority: -1,
                    inject: (sessionId) => {
                      const directory = models.directoryFor(sessionId);
                      const available = sessions.subagentAddress(sessionId) === undefined;
                      return {
                        available,
                        directory: directory.store,
                        load: () => {
                          if (available) directory.load().catch(() => {});
                        },
                        select: (selection) =>
                          available ? directory.select(selection) : Promise.resolve(undefined)
                      };
                    }
                  },
                  ModelSeat
                )
              );
            } catch (failure) {
              console.warn("[vibestack] model seat replacement failed", failure);
            }
          });
        })
        .catch(() => {});
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
