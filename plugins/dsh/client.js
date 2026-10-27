// VibeStack browser half for DeepSeek Harness.
//
// Shipped as a prebuilt client bundle: a factory registered on the module
// loader. Only React (a platform-seeded module) is required, so no build step
// is involved.
//
// The picker renders in the composer dock and hides itself unless the session
// runs the `vibestack` agent preset. Selecting an agent runs the mode's
// `/vibestack-agent <name>` command, which writes the session projection the
// host applies as the persona.
window.__ModuleLoader__.load({
  id: "dsh-vibestack",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
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

    const styles = {
      root: { position: "relative", display: "inline-flex", alignItems: "center" },
      button: {
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        height: "26px",
        padding: "0 10px",
        borderRadius: "999px",
        border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
        background: "transparent",
        color: "var(--dsw-alias-label-secondary, inherit)",
        fontSize: "12px",
        lineHeight: "26px",
        cursor: "pointer"
      },
      dot: { fontSize: "9px", opacity: 0.75 },
      label: { maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      caret: { fontSize: "9px", opacity: 0.7 },
      menu: {
        position: "absolute",
        bottom: "calc(100% + 6px)",
        left: "0",
        minWidth: "220px",
        maxHeight: "320px",
        overflowY: "auto",
        padding: "4px",
        borderRadius: "10px",
        border: "1px solid var(--dsw-alias-border-l1, rgba(127,127,127,0.28))",
        background: "var(--dsw-specific-menu, #1f1f1f)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
        zIndex: 40,
        display: "flex",
        flexDirection: "column",
        gap: "2px"
      },
      item: {
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "2px",
        width: "100%",
        padding: "6px 8px",
        borderRadius: "6px",
        border: "none",
        background: "transparent",
        color: "var(--dsw-alias-label-primary, inherit)",
        textAlign: "left",
        cursor: "pointer",
        fontSize: "12px"
      },
      itemActive: { background: "var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,0.18))" },
      itemName: { fontWeight: 500 },
      itemDesc: {
        fontSize: "11px",
        opacity: 0.7,
        maxWidth: "260px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    };

    /**
     * Composer-dock agent picker for the VibeStack mode.
     * @param {{useProjection: Function, onSelect: (name: string) => Promise<void>}} props - slot props.
     * @returns {object | null} react element or null outside the mode.
     */
    function AgentPicker(props) {
      const state = props.useProjection("vibestack");
      const preset = props.useProjection("agentPreset");
      const [open, setOpen] = react.useState(false);
      const [busy, setBusy] = react.useState(false);
      const rootRef = react.useRef(null);

      const agents = state && Array.isArray(state.agents) ? state.agents : [];
      const selected = state && typeof state.selected === "string" ? state.selected : null;

      react.useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          const node = rootRef.current;
          if (node && event.target instanceof Node && node.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
          document.removeEventListener("mousedown", onPointerDown);
          document.removeEventListener("keydown", onKeyDown);
        };
      }, [open]);

      if (preset !== "vibestack" || agents.length === 0) return null;

      const choose = async (name) => {
        setOpen(false);
        if (busy || name === selected) return;
        setBusy(true);
        try {
          await props.onSelect(name);
        } catch (error) {
          console.warn("[vibestack] agent selection failed", error);
        } finally {
          setBusy(false);
        }
      };

      return h(
        "div",
        { style: styles.root, ref: rootRef },
        h(
          "button",
          {
            type: "button",
            style: styles.button,
            title: "VibeStack Agent（本会话人设）",
            "aria-haspopup": "menu",
            "aria-expanded": open,
            disabled: busy,
            onClick: () => setOpen((value) => !value)
          },
          h("span", { style: styles.dot, "aria-hidden": true }, "◆"),
          h("span", { style: styles.label }, selected === null ? "选择 Agent" : selected),
          h("span", { style: styles.caret, "aria-hidden": true }, "▾")
        ),
        open
          ? h(
              "div",
              { style: styles.menu, role: "menu" },
              agents.map((agent) =>
                h(
                  "button",
                  {
                    key: agent.name,
                    type: "button",
                    role: "menuitemradio",
                    "aria-checked": agent.name === selected,
                    style:
                      agent.name === selected
                        ? Object.assign({}, styles.item, styles.itemActive)
                        : styles.item,
                    onClick: () => void choose(agent.name)
                  },
                  h("span", { style: styles.itemName }, agent.name),
                  agent.description
                    ? h("span", { style: styles.itemDesc }, agent.description)
                    : null
                )
              )
            )
          : null
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
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
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
