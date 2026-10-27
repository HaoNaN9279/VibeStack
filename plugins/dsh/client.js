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
// Selecting an agent runs the mode's `/vibestack-agent <name>` command, which
// writes the session projection the host applies as the persona.
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

      const agents = state && Array.isArray(state.agents) ? state.agents : [];
      const selected = state && typeof state.selected === "string" ? state.selected : null;
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
                  h("span", { style: styles.menuHint }, "切换后只影响本会话人设")
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
                      h("span", { style: styles.itemName }, agent.name),
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
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
