import { createComponent as _$createComponent } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { ContextBreakdown } from "../rpc.js";
const LABELS = {
  mcp: "MCP tools",
  tools: "System tools",
  system: "System prompt",
  skills: "Skills",
  messages: "Messages"
};
const COLORS = {
  mcp: "#3b82f6",
  tools: "#f97316",
  system: "#10b981",
  skills: "#f59e0b",
  messages: "#ec4899"
};
const BUFFER_COLOR = "#9ca3af";
const FALLBACK_WIDTH = 34;
const TOKEN_WIDTH = 8;
const PERCENT_WIDTH = 6;
function compact(value) {
  if (!Number.isFinite(value)) return "-";
  const absolute = Math.abs(value);
  const trim = number => number.toFixed(1).replace(/\.0$/, "");
  if (absolute >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (absolute >= 1_000) return `${trim(value / 1_000)}K`;
  return String(Math.round(value));
}
function percent(value, limit) {
  if (limit <= 0) return "0.0%";
  const ratio = Math.max(0, Math.min(100, value / limit * 100));
  return `${ratio.toFixed(1)}%`;
}
function truncate(value, width) {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return `${value.slice(0, width - 1)}…`;
}
function freeColor(themeMode) {
  return themeMode === "light" ? "#d4d4d8" : "#3f3f46";
}
function allocate(segments, total, cells) {
  if (total <= 0 || cells <= 0) return [];
  const active = segments.filter(segment => segment.tokens > 0);
  if (active.length === 0) return [];
  let accumulated = 0;
  let previous = 0;
  const result = active.map(segment => {
    accumulated += segment.tokens;
    const end = Math.min(cells, Math.round(accumulated / total * cells));
    const width = Math.max(1, end - previous);
    previous = end;
    return {
      cells: width,
      color: segment.color
    };
  });
  let used = result.reduce((sum, segment) => sum + segment.cells, 0);
  if (used < cells) result[result.length - 1].cells += cells - used;
  while (used > cells) {
    let largest = -1;
    for (let index = 0; index < result.length; index++) {
      if (result[index].cells <= 1) continue;
      if (largest === -1 || result[index].cells > result[largest].cells) largest = index;
    }
    if (largest === -1) break;
    result[largest].cells -= 1;
    used -= 1;
  }
  return result.filter(segment => segment.cells > 0);
}
function Row(props) {
  return (() => {
    var _el$ = _$createElement("box"),
      _el$2 = _$createElement("text"),
      _el$4 = _$createElement("text"),
      _el$5 = _$createElement("text"),
      _el$6 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$4);
    _$insertNode(_el$, _el$5);
    _$insertNode(_el$, _el$6);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "gap", 1);
    _$insertNode(_el$2, _$createTextNode(`•`));
    _$setProp(_el$2, "flexShrink", 0);
    _$setProp(_el$4, "flexGrow", 1);
    _$setProp(_el$4, "flexShrink", 1);
    _$setProp(_el$4, "minWidth", 0);
    _$setProp(_el$4, "wrapMode", "none");
    _$setProp(_el$4, "truncate", true);
    _$insert(_el$4, () => props.label);
    _$setProp(_el$5, "width", 8);
    _$setProp(_el$5, "flexShrink", 0);
    _$insert(_el$5, () => compact(props.tokens).padStart(TOKEN_WIDTH));
    _$setProp(_el$6, "width", 6);
    _$setProp(_el$6, "flexShrink", 0);
    _$insert(_el$6, () => percent(props.tokens, props.limit).padStart(PERCENT_WIDTH));
    _$effect(_p$ => {
      var _v$ = props.color,
        _v$2 = props.theme.text.muted,
        _v$3 = props.theme.text.base,
        _v$4 = props.theme.text.base;
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$2, _p$.t));
      _v$3 !== _p$.a && (_p$.a = _$setProp(_el$5, "fg", _v$3, _p$.a));
      _v$4 !== _p$.o && (_p$.o = _$setProp(_el$6, "fg", _v$4, _p$.o));
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined
    });
    return _el$;
  })();
}
function Panel(props) {
  props.ensure(props.sessionID);
  const theme = props.ctx.theme;
  const entry = () => props.cache[props.sessionID];
  const snapshot = () => entry()?.snapshot;
  const width = () => props.ui.width[props.sessionID] || FALLBACK_WIDTH;
  const [view, updateView] = props.ctx.storage.store("view", {
    initial: {
      open: true
    }
  });
  const open = () => view.open;
  const toggle = () => {
    void updateView(draft => {
      draft.open = !draft.open;
    }).catch(() => {});
  };
  const segments = () => {
    const data = snapshot();
    if (!data) return [];
    const parts = data.parts.map(part => ({
      tokens: part.tokens,
      color: COLORS[part.key] ?? "#94a3b8"
    }));
    const used = data.parts.reduce((sum, part) => sum + part.tokens, 0);
    const free = Math.max(0, data.limit - used - data.buffer);
    return [...(parts.length > 0 ? parts : [{
      tokens: data.used,
      color: props.ctx.theme.text.muted
    }]), {
      tokens: data.buffer,
      color: BUFFER_COLOR
    }, {
      tokens: free,
      color: freeColor(props.ctx.themeMode)
    }];
  };
  const headerRatio = () => {
    const data = snapshot();
    if (!data || data.limit <= 0) return "0";
    const ratio = Math.max(0, Math.min(100, Math.round(data.used / data.limit * 100)));
    return ratio === 0 && data.used > 0 ? "<1" : String(ratio);
  };
  const headerLeft = () => `${headerRatio()}% used`;
  const headerRight = () => `${compact(snapshot().used)} / ${compact(snapshot().limit)}`;
  return (() => {
    var _el$7 = _$createElement("box"),
      _el$8 = _$createElement("box"),
      _el$9 = _$createElement("text"),
      _el$0 = _$createElement("text"),
      _el$1 = _$createElement("b");
    _$insertNode(_el$7, _el$8);
    _$use(element => {
      if (!element) return;
      const update = () => {
        const next = (element.width ?? 0) | 0;
        if (!next) return;
        props.setUI(draft => {
          if (draft.width[props.sessionID] !== next) draft.width[props.sessionID] = next;
        });
      };
      element.onSizeChange = update;
      queueMicrotask(update);
    }, _el$7);
    _$setProp(_el$7, "flexDirection", "column");
    _$setProp(_el$7, "width", "100%");
    _$insertNode(_el$8, _el$9);
    _$insertNode(_el$8, _el$0);
    _$setProp(_el$8, "flexDirection", "row");
    _$setProp(_el$8, "gap", 1);
    _$setProp(_el$8, "onMouseDown", toggle);
    _$insert(_el$9, () => open() ? "▼" : "▶");
    _$insertNode(_el$0, _el$1);
    _$insertNode(_el$1, _$createTextNode(`Context`));
    _$insert(_el$0, (() => {
      var _c$ = _$memo(() => !!(!open() && snapshot()));
      return () => _c$() ? (() => {
        var _el$11 = _$createElement("span");
        _$insert(_el$11, () => ` (${headerRatio()}% used)`);
        _$effect(_$p => _$setProp(_el$11, "style", {
          fg: theme.text.muted
        }, _$p));
        return _el$11;
      })() : null;
    })(), null);
    _$insert(_el$7, (() => {
      var _c$2 = _$memo(() => !!!open());
      return () => _c$2() ? null : [_$memo(() => _$memo(() => !!(entry()?.error && !snapshot()))() ? (() => {
        var _el$12 = _$createElement("text");
        _$insert(_el$12, () => `Context unavailable: ${truncate(entry().error, width())}`);
        _$effect(_$p => _$setProp(_el$12, "fg", theme.text.feedback.error.base, _$p));
        return _el$12;
      })() : null), _$memo(() => _$memo(() => !!snapshot())() ? [(() => {
        var _el$13 = _$createElement("box"),
          _el$14 = _$createElement("text"),
          _el$15 = _$createElement("text");
        _$insertNode(_el$13, _el$14);
        _$insertNode(_el$13, _el$15);
        _$setProp(_el$13, "flexDirection", "row");
        _$setProp(_el$13, "gap", 1);
        _$setProp(_el$14, "flexGrow", 1);
        _$insert(_el$14, headerLeft);
        _$insert(_el$15, headerRight);
        _$effect(_p$ => {
          var _v$7 = theme.text.base,
            _v$8 = theme.text.muted;
          _v$7 !== _p$.e && (_p$.e = _$setProp(_el$14, "fg", _v$7, _p$.e));
          _v$8 !== _p$.t && (_p$.t = _$setProp(_el$15, "fg", _v$8, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$13;
      })(), (() => {
        var _el$16 = _$createElement("box");
        _$setProp(_el$16, "flexDirection", "row");
        _$setProp(_el$16, "height", 1);
        _$setProp(_el$16, "width", "100%");
        _$insert(_el$16, () => allocate(segments(), snapshot().limit, Math.max(1, width())).map(segment => (() => {
          var _el$19 = _$createElement("text");
          _$setProp(_el$19, "attributes", 1);
          _$insert(_el$19, () => "▬".repeat(segment.cells));
          _$effect(_$p => _$setProp(_el$19, "fg", segment.color, _$p));
          return _el$19;
        })()));
        return _el$16;
      })(), _$memo(() => snapshot().parts.map(part => _$createComponent(Row, {
        theme: theme,
        get color() {
          return COLORS[part.key] ?? "#94a3b8";
        },
        get label() {
          return LABELS[part.key] ?? part.key;
        },
        get tokens() {
          return part.tokens;
        },
        get limit() {
          return snapshot().limit;
        }
      }))), _$createComponent(Row, {
        theme: theme,
        color: BUFFER_COLOR,
        label: "Autocompact buffer",
        get tokens() {
          return snapshot().buffer;
        },
        get limit() {
          return snapshot().limit;
        }
      }), _$createComponent(Row, {
        theme: theme,
        get color() {
          return freeColor(props.ctx.themeMode);
        },
        label: "Free space",
        get tokens() {
          return Math.max(0, snapshot().limit - snapshot().used - snapshot().buffer);
        },
        get limit() {
          return snapshot().limit;
        }
      }), (() => {
        var _el$17 = _$createElement("text");
        _$insertNode(_el$17, _$createTextNode(` `));
        return _el$17;
      })()] : (() => {
        var _el$20 = _$createElement("text");
        _$insertNode(_el$20, _$createTextNode(`Loading context…`));
        _$effect(_$p => _$setProp(_el$20, "fg", theme.text.muted, _$p));
        return _el$20;
      })())];
    })(), null);
    _$effect(_p$ => {
      var _v$5 = theme.text.base,
        _v$6 = theme.text.base;
      _v$5 !== _p$.e && (_p$.e = _$setProp(_el$9, "fg", _v$5, _p$.e));
      _v$6 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$6, _p$.t));
      return _p$;
    }, {
      e: undefined,
      t: undefined
    });
    return _el$7;
  })();
}
export default Plugin.define({
  id: "context.sidebar",
  setup(ctx) {
    const [cache, setCache] = ctx.storage.memory("cache", {
      initial: {}
    });
    const [ui, setUI] = ctx.storage.memory("ui", {
      initial: {
        width: {}
      }
    });
    const inflight = new Set();
    const ensure = (sessionID, force = false) => {
      if (!sessionID || inflight.has(sessionID)) return;
      const entry = cache[sessionID];
      if (!force && entry && Date.now() - entry.at < 4000) return;
      inflight.add(sessionID);
      void ctx.client.rpc(ContextBreakdown).breakdown({
        sessionID
      }).then(result => {
        setCache(draft => {
          draft[sessionID] = {
            snapshot: result,
            at: Date.now()
          };
        });
      }).catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        setCache(draft => {
          draft[sessionID] = {
            error: message,
            at: Date.now()
          };
        });
      }).finally(() => {
        inflight.delete(sessionID);
      });
    };
    const summarize = async sessionID => {
      try {
        const snapshot = await ctx.client.rpc(ContextBreakdown).breakdown({
          sessionID
        });
        const ratio = snapshot.limit > 0 ? Math.round(snapshot.used / snapshot.limit * 100) : 0;
        ctx.ui.toast.show({
          title: "Context",
          message: `${ratio}% used | ${compact(snapshot.used)} / ${compact(snapshot.limit)}`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.toast.show({
          title: "Context",
          message,
          variant: "error"
        });
      }
    };
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "context.usage",
        title: "Context: show token usage",
        group: "Context",
        palette: true,
        slash: {
          name: "context"
        },
        run: async () => {
          const route = ctx.ui.router.current();
          if (route.type === "session") await summarize(route.sessionID);
        }
      }, {
        id: "context.refresh",
        title: "Context: refresh sidebar",
        group: "Context",
        palette: true,
        run: () => {
          const route = ctx.ui.router.current();
          if (route.type === "session") ensure(route.sessionID, true);
        }
      }]
    }));
    let timer;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        for (const sessionID of Object.keys(cache)) ensure(sessionID);
      }, 400);
    };
    const stops = [ctx.data.on("session.execution.succeeded", refresh), ctx.data.on("session.execution.failed", refresh), ctx.data.on("session.execution.interrupted", refresh), ctx.data.on("session.idle", refresh)];
    const disposeSlot = ctx.ui.slot({
      prepend: "sidebar.content",
      render: ({
        sessionID
      }) => _$createComponent(Panel, {
        ctx: ctx,
        sessionID: sessionID,
        cache: cache,
        ui: ui,
        setUI: setUI,
        ensure: ensure
      })
    });
    return () => {
      if (timer) clearTimeout(timer);
      for (const stop of stops) stop();
      disposeSlot();
    };
  }
});