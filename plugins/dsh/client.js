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
    const inject = ["slots", "remote", "remote.commands", "remote.session", "sessions"];

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
      itemDisabled: { opacity: 0.45, cursor: "default" },
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
    /** Read-only roster route used before the first pre-step publishes one. */
    const ROSTER_PATH = "/api/vibestack/roster";

    /**
     * Read the roster for a session that has not published one yet.
     * @param {string} sessionId - session id from the slot.
     * @returns {Promise<object | null>} roster payload or null.
     */
    async function readRoster(sessionId) {
      const response = await fetch(
        ROSTER_PATH + "?sessionId=" + encodeURIComponent(sessionId),
        { credentials: "same-origin", cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) return null;
      return payload.roster ?? null;
    }

    /**
     * Read the model-layer document from the host route.
     * @returns {Promise<{layers: object[], default: string | null, warnings?: string[], catalog?: object}>} payload.
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
     * @param {{bindings: object, custom: object[], default: string | null}} document - proposed bindings.
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
     *
     * Several default layers can share one route (all four default to
     * `deepseek-flash`), so a preferred id breaks the tie without hiding the
     * route-based fallback.

     * @param {object[]} layers - configured layers.
     * @param {object | undefined} selection - `{provider, model, reasoningEffort?}`.
     * @param {string | null} [preferredId] - layer to prefer when several match.
     * @returns {object | undefined} matching layer.
     */
    function activeLayer(layers, selection, preferredId = null) {
      if (!selection || typeof selection !== "object") return undefined;
      const matches = layers.filter(
        (layer) =>
          layer.bound !== false &&
          typeof layer.provider === "string" &&
          typeof layer.model === "string" &&
          layer.provider === selection.provider &&
          layer.model === selection.model &&
          (layer.reasoningEffort === undefined || layer.reasoningEffort === selection.reasoningEffort)
      );
      return matches.find((layer) => layer.id === preferredId) ?? matches[0];
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
        if (busy || layer.bound === false || (current && current.id === layer.id)) {
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
                  ? h("span", { style: styles.empty }, "模型层目录不可用（检查 vibe-stack 安装与版本）")
                  : layers.map((layer, index) =>
                      h(
                        "button",
                        {
                          key: layer.id,
                          type: "button",
                          role: "menuitemradio",
                          "aria-checked": current !== undefined && current.id === layer.id,
                          disabled: layer.bound === false,
                          tabIndex: -1,
                          style: layer.bound === false
                            ? Object.assign({}, styles.item, styles.itemDisabled)
                            : index === active
                              ? Object.assign({}, styles.item, styles.itemActive)
                              : styles.item,
                          onMouseEnter: () => setActive(index),
                          onClick: () => void choose(layer)
                        },
                        h("span", { style: styles.check, "aria-hidden": true }, current && current.id === layer.id ? "✓" : ""),
                        h(
                          "span",
                          { style: styles.itemBody },
                          h("span", { style: styles.itemName }, layer.label, h("span", { style: styles.itemGroup }, layer.id)),
                          h("span", { style: styles.itemDesc },
                            layer.bound === false
                              ? "未绑定本机模型（在设置页配置）"
                              : `${layer.provider}/${layer.model}${layer.reasoningEffort ? " · " + layer.reasoningEffort : ""}`)
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

      const toCustom = (layer) => ({
        id: layer.id,
        label: layer.label,
        description: layer.description ?? "",
        provider: layer.provider,
        model: layer.model,
        ...(layer.reasoningEffort ? { reasoningEffort: layer.reasoningEffort } : {})
      });

      const snapshot = (overrideId = null) => {
        const custom = [];
        for (const layer of layers) {
          if (overrideId !== null && layer.id === overrideId) continue;
          if (layer.custom) custom.push(toCustom(layer));
        }
        return { custom };
      };

      const publish = async (nextCustom, nextDefault) => {
        setBusy(true);
        setMessage(null);
        setError(null);
        try {
          // Platform bindings stay owned by `.vibestack/models.json`; omitting
          // `bindings` asks the service to keep only explicit local overrides.
          const payload = await writeLayerConfig({
            custom: nextCustom,
            default: nextDefault
          });
          setLayers(Array.isArray(payload.layers) ? payload.layers : []);
          setDefaultId(typeof payload.default === "string" ? payload.default : null);
          setMessage("已保存");
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure));
        } finally {
          setBusy(false);
        }
      };

      const defaultFor = (custom, candidate) => {
        if (candidate === null) return null;
        // Undefined asks the service to keep the explicit local default (if
        // any) instead of pinning the project default into the local config.
        return custom.some((layer) => layer.id === candidate) ? candidate : undefined;
      };

      const save = async () => {
        if (draft === null || !draft.custom) return;
        const originalId = draft._originalId ?? draft.id;
        const { custom } = snapshot(originalId);
        if (!draft.id) {
          setError("自定义层需要 id");
          return;
        }
        custom.push(toCustom(draft));
        const nextDefault = defaultId === originalId ? draft.id : defaultId;
        await publish(custom, defaultFor(custom, nextDefault));
        setDraft(null);
      };

      const removeCustom = async (layer) => {
        const { custom } = snapshot(layer.id);
        await publish(custom, defaultFor(custom, defaultId === layer.id ? null : defaultId));
      };

      const makeDefault = async (layer) => {
        if (layer.bound === false || !layer.custom) return;
        const { custom } = snapshot();
        await publish(custom, defaultFor(custom, defaultId === layer.id ? null : layer.id));
      };

      const resetDefault = async () => {
        const { custom } = snapshot();
        await publish(custom, null);
      };

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

      const routeOf = (layer) => layer.bound === false
        ? "未绑定本机模型"
        : `${layer.provider}/${layer.model}${layer.reasoningEffort ? " · " + layer.reasoningEffort : ""}`;
      const customDefault = layers.some((layer) => layer.custom && layer.id === defaultId);

      return h(
        "div",
        { style: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0 20px" } },
        h("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-tertiary, inherit)", lineHeight: "19px" } },
          "四个平台层由项目 .vibestack/models.json 提供，此处只读显示，默认层也由项目配置决定。本页只管理仅 DSH 可用的自定义层；能力组只写 model: <layer>。"),
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
          ? h("div", { style: { fontSize: "13px", color: "var(--dsw-alias-label-tertiary, inherit)" } }, "模型层目录不可用（检查 vibe-stack 安装与版本）。")
          : h("div", null, layers.map((layer) => {
              const readOnly = !layer.custom;
              return h("div", {
                key: layer.id,
                style: readOnly
                  ? Object.assign({}, rowStyle, { opacity: 0.55 })
                  : rowStyle
              },
                h("button", {
                  type: "button",
                  title: readOnly
                    ? "平台层默认由项目配置决定"
                    : layer.bound === false ? "未绑定，不能设为默认层" : "设为默认层",
                  disabled: readOnly || layer.bound === false || busy,
                  onClick: () => void makeDefault(layer),
                  style: {
                    flex: "none",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.4))",
                    background: defaultId === layer.id ? "var(--dsw-alias-state-business-primary, #4a7)" : "transparent",
                    color: "transparent",
                    cursor: readOnly || layer.bound === false ? "default" : "pointer"
                  }
                }, "•"),
                h("div", { style: { display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" } },
                  h("span", { style: { fontSize: "13px", fontWeight: 500 } },
                    `${layer.label} (${layer.id})${layer.custom ? " · 自定义" : " · 平台"}`),
                  h("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, inherit)" } },
                    `${routeOf(layer)}${defaultId === layer.id ? " · 默认" : ""}`)
                ),
                readOnly
                  ? h("span", { style: { flex: "none", fontSize: "11px", color: "var(--dsw-alias-label-tertiary, inherit)" } }, "项目配置")
                  : h(react.Fragment, null,
                      h("button", { type: "button", onClick: () => setDraft({ ...layer, _originalId: layer.id }), style: smallButton }, "编辑"),
                      h("button", { type: "button", disabled: busy, onClick: () => void removeCustom(layer), style: smallButton }, "删除")
                    )
              );
            })),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
          h("button", {
            type: "button",
            onClick: () => setDraft({ id: "", label: "", description: "", provider: "", model: "", reasoningEffort: "", custom: true }),
            style: primaryButton
          }, "新增自定义层（仅 DSH）"),
          customDefault
            ? h("button", { type: "button", disabled: busy, onClick: () => void resetDefault(), style: smallButton }, "恢复项目默认层")
            : null,
          h("button", { type: "button", onClick: () => void load(), style: smallButton }, "检测路由 / 重新读取")
        ),
        draft === null
          ? null
          : h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: "var(--dsw-radius-md, 10px)", border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.2))" } },
              h("div", { style: { fontSize: "12px", fontWeight: 600 } },
                draft.custom ? "自定义层（仅 DSH）" : `平台层绑定：${draft.id}`),
              draft.custom
                ? h(react.Fragment, null,
                    field("id", "id（小写 kebab，如 my-fast）", draft.id, (value) => setDraft({ ...draft, id: value })),
                    field("label", "显示名", draft.label, (value) => setDraft({ ...draft, label: value })),
                    field("description", "说明（可选）", draft.description, (value) => setDraft({ ...draft, description: value })))
                : h("div", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, inherit)" } },
                    `${draft.label} · 平台层 id 与名称不可修改`),
              field("provider", "provider（如 deepseek-account）", draft.provider, (value) => setDraft({ ...draft, provider: value })),
              field("model", "model（如 deepseek-flash）", draft.model, (value) => setDraft({ ...draft, model: value })),
              field("reasoningEffort", "reasoningEffort（可选）", draft.reasoningEffort, (value) => setDraft({ ...draft, reasoningEffort: value })),
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
      const [defaultLayerId, setDefaultLayerId] = react.useState(null);
      const [selectedLayerId, setSelectedLayerId] = react.useState(null);
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
      const storageKey = typeof props.sessionId === "string" && props.sessionId.length > 0
        ? `vibestack:selected-layer:${props.sessionId}`
        : null;
      const remembered = layers.find((entry) => entry.id === selectedLayerId && entry.bound !== false);
      const rememberedMatches = remembered !== undefined &&
        current !== null &&
        remembered.provider === current.provider &&
        remembered.model === current.model &&
        (remembered.reasoningEffort ?? "") === (current.reasoningEffort ?? "");
      const layer = isVibeStack
        ? (rememberedMatches ? remembered : activeLayer(layers, current, defaultLayerId))
        : undefined;

      const remember = react.useCallback((id) => {
        setSelectedLayerId(id);
        if (storageKey === null) return;
        try {
          if (id === null) window.sessionStorage.removeItem(storageKey);
          else window.sessionStorage.setItem(storageKey, id);
        } catch {
          // Storage can be unavailable in hardened browser contexts.
        }
      }, [storageKey]);

      react.useEffect(() => {
        if (!isVibeStack || storageKey === null) {
          setSelectedLayerId(null);
          return;
        }
        try {
          setSelectedLayerId(window.sessionStorage.getItem(storageKey));
        } catch {
          setSelectedLayerId(null);
        }
      }, [isVibeStack, storageKey]);

      react.useEffect(() => {
        if (!props.available) return;
        props.load?.();
        if (!isVibeStack) return;
        let alive = true;
        readLayerConfig()
          .then((payload) => {
            if (!alive) return;
            setLayers(Array.isArray(payload.layers) ? payload.layers : []);
            setDefaultLayerId(typeof payload.default === "string" ? payload.default : null);
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
        layerId: entry.id,
        label: entry.label,
        detail: entry.bound === false
          ? "未绑定本机模型"
          : `${entry.provider}/${entry.model}${entry.reasoningEffort ? " · " + entry.reasoningEffort : ""}`,
        selected: layer !== undefined && layer.id === entry.id,
        disabled: entry.bound === false,
        selection: entry.bound === false
          ? undefined
          : {
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
        if (busy || option.selected || option.disabled) {
          setOpen(false);
          return;
        }
        restoreFocus.current = true;
        setBusy(true);
        try {
          if (option.layerId && typeof props.selectLayer === "function") {
            // Apply by layer id instead of provider/model: the four default
            // layers can share one route, so only the command can tell them
            // apart.
            const result = await props.selectLayer(option.layerId);
            if (result && result.ok === false) {
              throw new Error(`${result.error?.code ?? "layer-unavailable"}: ${result.error?.message ?? ""}`);
            }
            remember(option.layerId);
          } else {
            const result = await props.select(option.selection);
            if (result && result.ok === false) {
              throw new Error(`${result.error?.code ?? "model-unavailable"}: ${result.error?.message ?? ""}`);
            }
            remember(null);
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
                          "aria-disabled": option.disabled === true,
                          tabIndex: -1,
                          style: Object.assign(
                            {},
                            styles.item,
                            option.disabled ? { opacity: 0.5, cursor: "default" } : {},
                            index === active ? styles.itemActive : {}
                          ),
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
      color: "var(--dsw-alias-label-secondary, inherit)",
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
      const [fallback, setFallback] = react.useState(null);
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const [active, setActive] = react.useState(0);
      const [pos, setPos] = react.useState(null);
      const rootRef = react.useRef(null);
      const triggerRef = react.useRef(null);
      const menuRef = react.useRef(null);
      const idRef = react.useRef(null);
      const restoreFocus = react.useRef(false);
      const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";

      if (idRef.current === null) {
        pickerSeq += 1;
        idRef.current = "vibestack-agent-menu-" + pickerSeq;
      }

      const projectionRoster = state && Array.isArray(state.agents) ? state.agents : [];

      // A blank session has no stored roster yet: the on-disk format forbids
      // any surface event before the first system/message, so the host serves
      // the pre-turn roster through a read-only route instead.
      react.useEffect(() => {
        if (preset !== "vibestack" || sessionId.length === 0 || projectionRoster.length > 0) {
          setFallback(null);
          return undefined;
        }
        let cancelled = false;
        readRoster(sessionId)
          .then((next) => {
            if (!cancelled) setFallback(next);
          })
          .catch(() => {
            if (!cancelled) setFallback(null);
          });
        return () => {
          cancelled = true;
        };
      }, [preset, sessionId, projectionRoster.length]);

      const roster = projectionRoster.length > 0
        ? projectionRoster
        : fallback && Array.isArray(fallback.agents)
          ? fallback.agents
          : [];
      // subagent-only definitions stay in the roster but not in the persona menu.
      const agents = roster.filter((agent) => agent && agent.mode !== "subagent");
      const canonical = (name) => {
        if (typeof name !== "string" || name.length === 0) return null;
        const found = agents.find((agent) => agent.name.toLowerCase() === name.toLowerCase());
        return found === undefined ? null : found.name;
      };
      const selected =
        canonical(state && state.selected) ??
        canonical(fallback && fallback.defaultSelected);
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

/** Fetch route that lists what the current session loads. */
const INVENTORY_PATH = "/api/vibestack/inventory";
/** Fetch route that returns one inventory entry's full text. */
const INVENTORY_TEXT_PATH = "/api/vibestack/inventory/text";

/** Status glyphs shared with `vibe-stack preview`. */
const INVENTORY_STATUS = {
  injected: { mark: "+", label: "已注入" },
  indexed: { mark: "~", label: "仅索引" },
  omitted: { mark: "!", label: "超预算" },
  skipped: { mark: "-", label: "未加载" },
  active: { mark: "*", label: "生效" }
};

/**
 * Read a slot snapshot hook without letting an absent hook break the panel.
 *
 * The composer slot always hands us `useSessions` and `useWorkspaces`; a plain
 * unit test or an older host may not, so the call is defensive. The hook is
 * called in the same order on every render of this component.
 * @param {Function | undefined} hook - snapshot selector hook.
 * @returns {any} the snapshot, or null.
 */
function useOptionalSnapshot(hook) {
  if (typeof hook !== "function") return null;
  try {
    return hook((snapshot) => snapshot);
  } catch {
    return null;
  }
}

/**
 * Collect the session summaries out of a sessions snapshot.
 *
 * The client keeps the list as `{phase, ids, byId}`; older or plain fixtures
 * hand back an array, `.items` or `.sessions`. All three shapes are accepted.
 * @param {any} snapshot - sessions snapshot.
 * @returns {Array<object>} summaries.
 */
function sessionSummaries(snapshot) {
  if (snapshot === null || typeof snapshot !== "object") return [];
  if (Array.isArray(snapshot)) return snapshot;
  const items = snapshot.items ?? snapshot.sessions;
  if (Array.isArray(items)) return items;
  if (Array.isArray(snapshot.ids) && snapshot.byId !== null && typeof snapshot.byId === "object") {
    return snapshot.ids.map((id) => snapshot.byId[id]).filter((entry) => entry !== undefined);
  }
  const table = snapshot.byId;
  return table !== null && typeof table === "object" ? Object.values(table) : [];
}

/**
 * Collect the workspace records out of a workspaces snapshot.
 *
 * The client exposes `{phase, items, archivedSessionIds}`; each item carries
 * `workspaceId`, `path` and `sessionIds`. Array, `.workspaces` and `.byId`
 * fixtures are accepted too.
 * @param {any} snapshot - workspaces snapshot.
 * @returns {Array<object>} workspaces.
 */
function workspaceRecords(snapshot) {
  if (snapshot === null || typeof snapshot !== "object") return [];
  if (Array.isArray(snapshot)) return snapshot;
  const items = snapshot.items ?? snapshot.workspaces;
  if (Array.isArray(items)) return items;
  const table = snapshot.byId;
  return table !== null && typeof table === "object" ? Object.values(table) : [];
}

/**
 * Pick the directory a brand-new window belongs to.
 *
 * A window that has not sent a prompt yet has no host session, so the server
 * cannot know its workspace. The client does: a blank session summary carries
 * `cwd`, and the workspace record lists the path of every workspace that owns
 * the session. Only values the client can actually observe are used; when none
 * exists the server keeps its own fallbacks.
 * @param {any} sessions - sessions snapshot.
 * @param {any} workspaces - workspaces snapshot.
 * @param {string} sessionId - window session id.
 * @returns {string} absolute directory, or an empty string.
 */
function inventoryCwdHint(sessions, workspaces, sessionId) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return "";
  for (const entry of sessionSummaries(sessions)) {
    if (entry === null || typeof entry !== "object") continue;
    const id = typeof entry.sessionId === "string" ? entry.sessionId : entry.id;
    if (id !== sessionId) continue;
    if (typeof entry.cwd === "string" && entry.cwd.length > 0) return entry.cwd;
    const projected = entry.projectionValues?.workingDirectory;
    if (typeof projected === "string" && projected.length > 0) return projected;
  }
  const records = workspaceRecords(workspaces);
  for (const record of records) {
    if (record === null || typeof record !== "object") continue;
    const owned = Array.isArray(record.sessionIds) && record.sessionIds.includes(sessionId);
    if (owned && typeof record.path === "string" && record.path.length > 0) return record.path;
  }
  return "";
}

/**
 * Read the session inventory.
 * @param {string} sessionId - live session id.
 * @param {string} agent - selected persona name, or an empty string.
 * @param {string} [hint] - workspace directory the window belongs to.
 * @returns {Promise<object>} inventory payload.
 */
async function readInventory(sessionId, agent, hint) {
  const query = new URLSearchParams({ sessionId });
  if (typeof agent === "string" && agent.length > 0) query.set("agent", agent);
  if (typeof hint === "string" && hint.length > 0) query.set("cwd", hint);
  const response = await fetch(`${INVENTORY_PATH}?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message ?? payload.code ?? `HTTP ${response.status}`);
  }
  return payload.inventory ?? null;
}

/**
 * Read one inventory entry's full text.
 * @param {string} sessionId - live session id.
 * @param {string} kind - entry kind.
 * @param {string} id - entry id.
 * @param {string} [hint] - workspace directory the window belongs to.
 * @returns {Promise<{text: string, truncated: boolean, path: string}>} preview payload.
 */
async function readInventoryText(sessionId, kind, id, hint) {
  const query = new URLSearchParams({ sessionId, kind, id });
  if (typeof hint === "string" && hint.length > 0) query.set("cwd", hint);
  const response = await fetch(`${INVENTORY_TEXT_PATH}?${query.toString()}`, {
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message ?? payload.code ?? `HTTP ${response.status}`);
  }
  return {
    text: typeof payload.text === "string" ? payload.text : "",
    truncated: payload.truncated === true,
    path: typeof payload.path === "string" ? payload.path : ""
  };
}

/**
 * Copy text to the clipboard, tolerating a denied clipboard permission.
 * @param {string} text - text to copy.
 * @returns {Promise<boolean>} whether the copy succeeded.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Styles for the inventory button, dialog and hover card. */
const inventoryStyles = {
  button: {
    flex: "none",
    width: "28px",
    height: "28px",
    padding: "0",
    borderRadius: "var(--dsw-radius-sm, 6px)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
    background: "transparent",
    color: "var(--dsw-alias-label-secondary, inherit)",
    fontFamily: "inherit",
    fontSize: "13px",
    lineHeight: "1",
    cursor: "pointer"
  },
  overlay: {
    position: "fixed",
    inset: "0",
    zIndex: 70,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
    background: "var(--dsw-alias-bg-mask-1, rgba(0,0,0,0.42))",
    backdropFilter: "var(--dsw-mask-blur, blur(4px))",
    WebkitBackdropFilter: "var(--dsw-mask-blur, blur(4px))"
  },
  dialog: {
    display: "flex",
    flexDirection: "column",
    width: "min(940px, 92vw)",
    maxHeight: "86vh",
    borderRadius: "var(--dsw-radius-lg, 12px)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
    background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #1f1f1f))",
    backdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
    WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
    color: "var(--dsw-alias-label-primary, inherit)",
    boxShadow: "var(--dsw-elevation-panel, 0 18px 48px rgba(0,0,0,0.28))",
    overflow: "hidden"
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    padding: "12px 14px",
    borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.18))"
  },
  title: { fontSize: "14px", fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
  subtitle: { fontSize: "12px", color: "var(--dsw-alias-label-tertiary, inherit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  spacer: { flex: "1 1 auto" },
  body: { flex: "1 1 auto", overflow: "auto", padding: "6px 10px 14px" },
  section: { marginTop: "10px" },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    padding: "6px 4px",
    border: "none",
    background: "transparent",
    color: "var(--dsw-alias-label-secondary, inherit)",
    fontFamily: "inherit",
    fontSize: "12px",
    fontWeight: 600,
    textAlign: "left",
    cursor: "pointer"
  },
  count: { fontWeight: 400, color: "var(--dsw-alias-label-tertiary, inherit)" },
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    padding: "6px 4px",
    borderTop: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.1))"
  },
  mark: { flex: "none", width: "14px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px", color: "var(--dsw-alias-label-tertiary, inherit)" },
  rowBody: { flex: "1 1 auto", minWidth: "0" },
  rowName: { display: "flex", alignItems: "center", gap: "6px", fontSize: "12.5px", fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)" },
  rowMeta: { marginTop: "2px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "11px", color: "var(--dsw-alias-label-tertiary, inherit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowSummary: { marginTop: "2px", fontSize: "12px", color: "var(--dsw-alias-label-secondary, inherit)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" },
  previewButton: {
    flex: "none",
    width: "24px",
    height: "24px",
    padding: "0",
    borderRadius: "var(--dsw-radius-sm, 6px)",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--dsw-alias-label-secondary, inherit)",
    fontFamily: "inherit",
    fontSize: "12px",
    cursor: "pointer"
  },
  muted: { padding: "14px 6px", fontSize: "12px", color: "var(--dsw-alias-label-tertiary, inherit)" },
  error: { padding: "14px 6px", fontSize: "12px", color: "var(--dsw-alias-state-error-primary, #c0392b)" },
  card: {
    position: "fixed",
    zIndex: 71,
    display: "flex",
    flexDirection: "column",
    width: "min(560px, 92vw)",
    maxHeight: "70vh",
    borderRadius: "var(--dsw-radius-lg, 10px)",
    border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.3))",
    background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2, #1f1f1f))",
    backdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
    WebkitBackdropFilter: "var(--dsw-menu-backdrop-filter, blur(40px) saturate(150%))",
    color: "var(--dsw-alias-label-primary, inherit)",
    boxShadow: "var(--dsw-elevation-panel, 0 14px 36px rgba(0,0,0,0.24))",
    overflow: "hidden"
  },
  cardHead: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    borderBottom: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.16))"
  },
  cardTitle: { flex: "1 1 auto", minWidth: "0", fontSize: "12px", fontWeight: 600, color: "var(--dsw-alias-label-primary, inherit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardBody: { flex: "1 1 auto", overflow: "auto", padding: "10px 12px" },
  pre: {
    margin: "0",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "12px",
    lineHeight: "1.55",
    color: "var(--dsw-alias-label-primary, inherit)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word"
  },
  cardFoot: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "8px 10px",
    borderTop: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.16))",
    fontSize: "11px",
    color: "var(--dsw-alias-label-tertiary, inherit)"
  }
};

/**
 * Position the hover card beside an icon without leaving the viewport.
 * @param {DOMRect} rect - preview icon rect.
 * @returns {{left: string, top: string}} fixed offsets.
 */
function placeInventoryCard(rect) {
  const margin = 10;
  const width = Math.min(560, window.innerWidth * 0.92);
  const height = Math.min(window.innerHeight * 0.7, 420);
  let left = rect.right + margin;
  if (left + width > window.innerWidth - margin) left = rect.left - width - margin;
  if (left < margin) left = margin;
  let top = rect.top;
  if (top + height > window.innerHeight - margin) top = window.innerHeight - height - margin;
  if (top < margin) top = margin;
  return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
}

/**
 * Error boundary: a broken panel must never take the composer down.
 */
class InventoryBoundary extends react.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.warn("[vibestack] inventory panel failed", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Small button next to the Agent picker that opens the session inventory.
 * @param {{useProjection: Function, sessionId?: string}} props - slot props.
 * @returns {object | null} react element, or null outside the mode.
 */
function InventoryPanel(props) {
  const preset = props.useProjection("agentPreset");
  const sessionState = props.useProjection("vibestack");
  const sessionsSnapshot = useOptionalSnapshot(props.useSessions);
  const workspacesSnapshot = useOptionalSnapshot(props.useWorkspaces);
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : "";
  const cwdHint = inventoryCwdHint(sessionsSnapshot, workspacesSnapshot, sessionId);
  const [open, setOpen] = react.useState(false);
  const [data, setData] = react.useState(null);
  const [error, setError] = react.useState("");
  const [loading, setLoading] = react.useState(false);
  const [collapsed, setCollapsed] = react.useState({});
  const [hover, setHover] = react.useState(null);
  const [preview, setPreview] = react.useState(null);
  const [copied, setCopied] = react.useState("");
  const cacheRef = react.useRef(new Map());
  const showTimer = react.useRef(null);
  const hideTimer = react.useRef(null);
  const dialogRef = react.useRef(null);
  const selected = sessionState && typeof sessionState.selected === "string" ? sessionState.selected : "";

  const load = react.useCallback(async () => {
    if (sessionId.length === 0) {
      setData(null);
      setError("当前会话尚未就绪。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await readInventory(sessionId, selected, cwdHint);
      setData(next);
      setCollapsed({});
    } catch (failure) {
      setData(null);
      setError(String(failure?.message ?? failure));
    } finally {
      setLoading(false);
    }
  }, [sessionId, selected, cwdHint]);

  react.useEffect(() => {
    if (!open) return undefined;
    void load();
    dialogRef.current?.focus?.();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, load]);

  react.useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    []
  );

  // Fetch the hovered entry once and keep it in a per-panel cache.
  react.useEffect(() => {
    if (hover === null) {
      setPreview(null);
      return undefined;
    }
    const entry = hover.item;
    const key = `${entry.kind}\u0000${entry.id}`;
    const cached = cacheRef.current.get(key);
    if (cached !== undefined) {
      setPreview({ loading: false, error: "", path: entry.path, truncated: false, text: cached });
      return undefined;
    }
    let cancelled = false;
    setPreview({ loading: true, error: "", path: entry.path, truncated: false, text: "" });
    readInventoryText(sessionId, entry.kind, entry.id, cwdHint)
      .then((result) => {
        cacheRef.current.set(key, result.text);
        if (!cancelled) setPreview({ loading: false, error: "", ...result });
      })
      .catch((failure) => {
        if (!cancelled) {
          setPreview({ loading: false, error: String(failure?.message ?? failure), path: entry.path, truncated: false, text: "" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hover, sessionId, cwdHint]);

  if (preset !== "vibestack") return null;

  const openPreview = (item, event) => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    showTimer.current = setTimeout(() => setHover({ item, rect }), 120);
  };

  const closePreview = () => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), 180);
  };

  const keepPreview = () => {
    clearTimeout(hideTimer.current);
  };

  const markCopy = (label) => {
    setCopied(label);
    setTimeout(() => setCopied(""), 1200);
  };

  const button = h(
    "button",
    {
      type: "button",
      style: inventoryStyles.button,
      title: "会话内容预览：查看本会话与该工作区加载的规则、技能、命令、MCP 与人设",
      "aria-label": "会话内容预览",
      "aria-haspopup": "dialog",
      "aria-expanded": open,
      onClick: () => setOpen((value) => !value)
    },
    "▤"
  );

  if (!open) return button;

  const sections = data && Array.isArray(data.sections) ? data.sections : [];

  const modal = reactDom.createPortal(
    h(
      "div",
      {
        style: inventoryStyles.overlay,
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }
      },
      h(
        "div",
        {
          ref: dialogRef,
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "会话内容预览",
          tabIndex: -1,
          style: inventoryStyles.dialog,
          onMouseDown: (event) => event.stopPropagation()
        },
        h(
          "div",
          { style: inventoryStyles.header },
          h("span", { style: inventoryStyles.title }, "会话内容预览"),
          h(
            "span",
            { style: inventoryStyles.subtitle },
            data
              ? `${data.agent?.name ?? "无 Agent"} · ${data.cwd === "" ? "/" : data.cwd} · ${data.project}`
              : sessionId
          ),
          h("span", { style: inventoryStyles.spacer }),
          h(
            "button",
            {
              type: "button",
              style: smallButton,
              disabled: loading,
              onClick: () => void load()
            },
            loading ? "刷新中…" : "刷新"
          ),
          h(
            "button",
            {
              type: "button",
              style: smallButton,
              onClick: () => setOpen(false)
            },
            "关闭"
          )
        ),
        h(
          "div",
          { style: inventoryStyles.body },
          error.length > 0
            ? h("div", { style: inventoryStyles.error }, error)
            : loading && data === null
              ? h("div", { style: inventoryStyles.muted }, "加载中…")
              : data === null
                ? h("div", { style: inventoryStyles.muted }, "没有可显示的内容。")
                : sections.map((section) => {
                    const isCollapsed =
                      collapsed[section.kind] === undefined ? section.collapsed === true : collapsed[section.kind];
                    return h(
                      "div",
                      { key: section.kind, style: inventoryStyles.section },
                      h(
                        "button",
                        {
                          type: "button",
                          style: inventoryStyles.sectionHead,
                          "aria-expanded": !isCollapsed,
                          onClick: () =>
                            setCollapsed((current) => ({
                              ...current,
                              [section.kind]: !isCollapsed
                            }))
                        },
                        h("span", { "aria-hidden": true }, isCollapsed ? "▸" : "▾"),
                        h("span", null, section.title ?? section.kind),
                        h("span", { style: inventoryStyles.count }, `(${section.items.length})`)
                      ),
                      isCollapsed
                        ? null
                        : section.items.map((item) =>
                            h(
                              "div",
                              { key: `${section.kind}:${item.id}`, style: inventoryStyles.row },
                              h(
                                "span",
                                { style: inventoryStyles.mark, title: INVENTORY_STATUS[item.status]?.label ?? item.status },
                                INVENTORY_STATUS[item.status]?.mark ?? "·"
                              ),
                              h(
                                "div",
                                { style: inventoryStyles.rowBody },
                                h(
                                  "div",
                                  { style: inventoryStyles.rowName },
                                  h("span", null, item.name || item.id),
                                  item.host_name
                                    ? h("span", { style: inventoryStyles.rowMeta }, item.host_name)
                                    : null
                                ),
                                h(
                                  "div",
                                  { style: inventoryStyles.rowMeta },
                                  [
                                    item.id,
                                    item.group ? `group: ${item.group}` : "",
                                    item.module ? `module: ${item.module}` : "",
                                    item.scope ? `scope: ${item.scope}` : "",
                                    item.bytes > 0 ? `${item.bytes} B` : "",
                                    item.status
                                  ]
                                    .filter((part) => part.length > 0)
                                    .join(" · ")
                                ),
                                item.summary
                                  ? h("div", { style: inventoryStyles.rowSummary }, item.summary)
                                  : null
                              ),
                              h(
                                "button",
                                {
                                  type: "button",
                                  style: inventoryStyles.previewButton,
                                  title: "悬停预览全文",
                                  "aria-label": `预览 ${item.name || item.id}`,
                                  onMouseEnter: (event) => openPreview(item, event),
                                  onMouseLeave: closePreview,
                                  onFocus: (event) => openPreview(item, event),
                                  onBlur: closePreview
                                },
                                "◉"
                              )
                            )
                          )
                    );
                  })
        ),
        data
          ? h(
              "div",
              { style: inventoryStyles.cardFoot },
              h("span", null, `预算 ${data.budget.used} / ${data.budget.limit} B`),
              h("span", null, `省略 ${data.budget.omitted}`),
              data.warnings.length > 0 ? h("span", null, `警告 ${data.warnings.length}`) : null,
              h("span", { style: inventoryStyles.spacer }),
              h("span", null, inlineCounts(sections))
            )
          : null
      )
    ),
    document.body
  );

  const card =
    hover !== null && preview !== null
      ? reactDom.createPortal(
          h(
            "div",
            {
              style: Object.assign({}, inventoryStyles.card, placeInventoryCard(hover.rect)),
              onMouseEnter: keepPreview,
              onMouseLeave: closePreview
            },
            h(
              "div",
              { style: inventoryStyles.cardHead },
              h(
                "span",
                { style: inventoryStyles.cardTitle },
                `${INVENTORY_STATUS[hover.item.status]?.label ?? ""} ${hover.item.name || hover.item.id}`
              ),
              h(
                "button",
                {
                  type: "button",
                  style: smallButton,
                  onClick: async () => {
                    const ok = await copyText(hover.item.path ?? "");
                    if (ok) markCopy("path");
                  }
                },
                copied === "path" ? "已复制" : "复制路径"
              ),
              h(
                "button",
                {
                  type: "button",
                  style: smallButton,
                  onClick: async () => {
                    const ok = await copyText(preview.text ?? "");
                    if (ok) markCopy("text");
                  }
                },
                copied === "text" ? "已复制" : "复制全文"
              )
            ),
            h(
              "div",
              { style: inventoryStyles.cardBody },
              preview.loading
                ? h("div", { style: inventoryStyles.muted }, "加载中…")
                : preview.error.length > 0
                  ? h("div", { style: inventoryStyles.error }, preview.error)
                  : preview.text.length === 0
                    ? h("div", { style: inventoryStyles.muted }, "该条目没有正文。")
                    : h("pre", { style: inventoryStyles.pre }, preview.text),
              preview.truncated ? h("div", { style: inventoryStyles.muted }, "内容过长，已截断。") : null
            ),
            h(
              "div",
              { style: inventoryStyles.cardFoot },
              h(
                "span",
                { style: Object.assign({}, inventoryStyles.rowMeta, { flex: "1 1 auto" }) },
                preview.path || hover.item.id
              )
            )
          ),
          document.body
        )
      : null;

  return h(react.Fragment, null, button, modal, card);
}

/**
 * One-line section counts for the dialog footer.
 * @param {object[]} sections - inventory sections.
 * @returns {string} text such as `规则 4 · 技能 12`.
 */
function inlineCounts(sections) {
  return sections
    .filter((section) => section.items.length > 0)
    .map((section) => `${section.title ?? section.kind} ${section.items.length}`)
    .join(" · ");
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
              sessionId,
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
      // The inventory button sits next to the Agent picker. It reads the plan
      // that the next step injects, so refreshing after an edit is honest.
      ctx.slots.inject("conversation.input.left", () =>
        ctx.slots.register(
          {
            name: "conversation.input.left",
            id: "vibestack-inventory",
            order: 8,
            inject: (sessionId) => ({ sessionId })
          },
          (props) => h(InventoryBoundary, null, h(InventoryPanel, props))
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
                        sessionId,
                        directory: directory.store,
                        load: () => {
                          if (available) directory.load().catch(() => {});
                        },
                        select: (selection) =>
                          available ? directory.select(selection) : Promise.resolve(undefined),
                        selectLayer: async (id) => {
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
                          return result;
                        }
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
