import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import type { Store } from "solid-js/store"
import { ContextBreakdown } from "../rpc.js"

type PartKey = "mcp" | "tools" | "system" | "skills" | "messages"

type Snapshot = {
  sessionID: string
  pending: boolean
  model: string
  limit: number
  used: number
  buffer: number
  updated: number
  note: string
  parts: Array<{ key: string; tokens: number }>
  mcp: Array<{ name: string; tools: number; tokens: number }>
}

type Entry = { snapshot?: Snapshot; error?: string; at: number }
type Cache = Record<string, Entry>
type UIState = { width: Record<string, number> }

const LABELS: Record<PartKey, string> = {
  mcp: "MCP tools",
  tools: "System tools",
  system: "System prompt",
  skills: "Skills",
  messages: "Messages",
}

const COLORS: Record<PartKey, string> = {
  mcp: "#3b82f6",
  tools: "#f97316",
  system: "#10b981",
  skills: "#f59e0b",
  messages: "#ec4899",
}

const BUFFER_COLOR = "#9ca3af"
const FALLBACK_WIDTH = 34
const TOKEN_WIDTH = 8
const PERCENT_WIDTH = 6

function compact(value: number): string {
  if (!Number.isFinite(value)) return "-"
  const absolute = Math.abs(value)
  const trim = (number: number) => number.toFixed(1).replace(/\.0$/, "")
  if (absolute >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (absolute >= 1_000) return `${trim(value / 1_000)}K`
  return String(Math.round(value))
}

function percent(value: number, limit: number): string {
  if (limit <= 0) return "0.0%"
  const ratio = Math.max(0, Math.min(100, (value / limit) * 100))
  return `${ratio.toFixed(1)}%`
}

function truncate(value: string, width: number): string {
  if (width <= 0) return ""
  if (value.length <= width) return value
  if (width <= 1) return value.slice(0, width)
  return `${value.slice(0, width - 1)}…`
}

function freeColor(themeMode: "dark" | "light"): string {
  return themeMode === "light" ? "#d4d4d8" : "#3f3f46"
}

function allocate(segments: Array<{ tokens: number; color: string }>, total: number, cells: number) {
  if (total <= 0 || cells <= 0) return []
  const active = segments.filter((segment) => segment.tokens > 0)
  if (active.length === 0) return []

  let accumulated = 0
  let previous = 0
  const result = active.map((segment) => {
    accumulated += segment.tokens
    const end = Math.min(cells, Math.round((accumulated / total) * cells))
    const width = Math.max(1, end - previous)
    previous = end
    return { cells: width, color: segment.color }
  })

  let used = result.reduce((sum, segment) => sum + segment.cells, 0)
  if (used < cells) result[result.length - 1].cells += cells - used
  while (used > cells) {
    let largest = -1
    for (let index = 0; index < result.length; index++) {
      if (result[index].cells <= 1) continue
      if (largest === -1 || result[index].cells > result[largest].cells) largest = index
    }
    if (largest === -1) break
    result[largest].cells -= 1
    used -= 1
  }
  return result.filter((segment) => segment.cells > 0)
}

function Row(props: {
  theme: Context["theme"]
  color: string
  label: string
  tokens: number
  limit: number
}) {
  return (
    <box flexDirection="row" gap={1}>
      <text flexShrink={0} fg={props.color}>{"•"}</text>
      <text flexGrow={1} flexShrink={1} minWidth={0} wrapMode="none" truncate fg={props.theme.text.muted}>{props.label}</text>
      <text width={TOKEN_WIDTH} flexShrink={0} fg={props.theme.text.base}>{compact(props.tokens).padStart(TOKEN_WIDTH)}</text>
      <text width={PERCENT_WIDTH} flexShrink={0} fg={props.theme.text.base}>{percent(props.tokens, props.limit).padStart(PERCENT_WIDTH)}</text>
    </box>
  )
}

function Panel(props: {
  ctx: Context
  sessionID: string
  cache: Store<Cache>
  ui: Store<UIState>
  setUI: (mutation: (draft: UIState) => void) => void
  ensure: (sessionID: string) => void
}) {
  props.ensure(props.sessionID)

  const theme = props.ctx.theme
  const entry = () => props.cache[props.sessionID]
  const snapshot = () => entry()?.snapshot
  const width = () => props.ui.width[props.sessionID] || FALLBACK_WIDTH
  const [view, updateView] = props.ctx.storage.store("view", { initial: { open: true } })
  const open = () => view.open
  const toggle = () => {
    void updateView((draft) => {
      draft.open = !draft.open
    }).catch(() => {})
  }

  const segments = () => {
    const data = snapshot()
    if (!data) return []
    const parts = data.parts.map((part) => ({
      tokens: part.tokens,
      color: COLORS[part.key as PartKey] ?? "#94a3b8",
    }))
    const used = data.parts.reduce((sum, part) => sum + part.tokens, 0)
    const free = Math.max(0, data.limit - used - data.buffer)
    return [
      ...(parts.length > 0 ? parts : [{ tokens: data.used, color: props.ctx.theme.text.muted }]),
      { tokens: data.buffer, color: BUFFER_COLOR },
      { tokens: free, color: freeColor(props.ctx.themeMode) },
    ]
  }

  const headerRatio = () => {
    const data = snapshot()
    if (!data || data.limit <= 0) return "0"
    const ratio = Math.max(0, Math.min(100, Math.round((data.used / data.limit) * 100)))
    return ratio === 0 && data.used > 0 ? "<1" : String(ratio)
  }

  const headerLeft = () => `${headerRatio()}% used`
  const headerRight = () => `${compact(snapshot()!.used)} / ${compact(snapshot()!.limit)}`
  return (
    <box
      flexDirection="column"
      width="100%"
      ref={((element: any) => {
        if (!element) return
        const update = () => {
          const next = (element.width ?? 0) | 0
          if (!next) return
          props.setUI((draft) => {
            if (draft.width[props.sessionID] !== next) draft.width[props.sessionID] = next
          })
        }
        element.onSizeChange = update
        queueMicrotask(update)
      }) as any}
    >
      <box flexDirection="row" gap={1} onMouseDown={toggle}><text fg={theme.text.base}>{open() ? "▼" : "▶"}</text><text fg={theme.text.base}><b>Context</b>{!open() && snapshot() ? <span style={{ fg: theme.text.muted }}>{` (${headerRatio()}% used)`}</span> : null}</text></box>

      {!open() ? null : (
        <>
          {entry()?.error && !snapshot() ? (
        <text fg={theme.text.feedback.error.base}>{`Context unavailable: ${truncate(entry()!.error!, width())}`}</text>
      ) : null}

      {snapshot() ? (
        <>
          <box flexDirection="row" gap={1}><text flexGrow={1} fg={theme.text.base}>{headerLeft()}</text><text fg={theme.text.muted}>{headerRight()}</text></box>

          <box flexDirection="row" height={1} width="100%">
            {allocate(segments(), snapshot()!.limit, Math.max(1, width())).map((segment) => (
              <text fg={segment.color} attributes={1}>{"▬".repeat(segment.cells)}</text>
            ))}
          </box>

          {snapshot()!.parts.map((part) => (
            <Row
              theme={theme}
              color={COLORS[part.key as PartKey] ?? "#94a3b8"}
              label={LABELS[part.key as PartKey] ?? part.key}
              tokens={part.tokens}
              limit={snapshot()!.limit}
            />
          ))}

          <Row
            theme={theme}
            color={BUFFER_COLOR}
            label="Autocompact buffer"
            tokens={snapshot()!.buffer}
            limit={snapshot()!.limit}
          />

          <Row
            theme={theme}
            color={freeColor(props.ctx.themeMode)}
            label="Free space"
            tokens={Math.max(0, snapshot()!.limit - snapshot()!.used - snapshot()!.buffer)}
            limit={snapshot()!.limit}
          />

          <text> </text>
        </>
      ) : (
        <text fg={theme.text.muted}>Loading context…</text>
      )}
        </>
      )}
    </box>
  )
}

export default Plugin.define({
  id: "context.sidebar",
  setup(ctx: Context) {
    const [cache, setCache] = ctx.storage.memory<Cache>("cache", { initial: {} })
    const [ui, setUI] = ctx.storage.memory<UIState>("ui", { initial: { width: {} } })
    const inflight = new Set<string>()

    const ensure = (sessionID: string, force = false) => {
      if (!sessionID || inflight.has(sessionID)) return
      const entry = cache[sessionID]
      if (!force && entry && Date.now() - entry.at < 4000) return
      inflight.add(sessionID)
      void ctx.client
        .rpc(ContextBreakdown)
        .breakdown({ sessionID })
        .then((result) => {
          setCache((draft) => {
            draft[sessionID] = { snapshot: result as Snapshot, at: Date.now() }
          })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          setCache((draft) => {
            draft[sessionID] = { error: message, at: Date.now() }
          })
        })
        .finally(() => {
          inflight.delete(sessionID)
        })
    }

    const summarize = async (sessionID: string) => {
      try {
        const snapshot = (await ctx.client.rpc(ContextBreakdown).breakdown({ sessionID })) as Snapshot
        const ratio = snapshot.limit > 0 ? Math.round((snapshot.used / snapshot.limit) * 100) : 0
        ctx.ui.toast.show({
          title: "Context",
          message: `${ratio}% used | ${compact(snapshot.used)} / ${compact(snapshot.limit)}`,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.ui.toast.show({ title: "Context", message, variant: "error" })
      }
    }

    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "context.usage",
          title: "Context: show token usage",
          group: "Context",
          palette: true,
          slash: { name: "context" },
          run: async () => {
            const route = ctx.ui.router.current()
            if (route.type === "session") await summarize(route.sessionID)
          },
        },
        {
          id: "context.refresh",
          title: "Context: refresh sidebar",
          group: "Context",
          palette: true,
          run: () => {
            const route = ctx.ui.router.current()
            if (route.type === "session") ensure(route.sessionID, true)
          },
        },
      ],
    }))

    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        for (const sessionID of Object.keys(cache)) ensure(sessionID)
      }, 400)
    }

    const stops = [
      ctx.data.on("session.execution.succeeded", refresh),
      ctx.data.on("session.execution.failed", refresh),
      ctx.data.on("session.execution.interrupted", refresh),
      ctx.data.on("session.idle", refresh),
    ]

    const disposeSlot = ctx.ui.slot({
      prepend: "sidebar.content",
      render: ({ sessionID }) => (
        <Panel
          ctx={ctx}
          sessionID={sessionID}
          cache={cache}
          ui={ui}
          setUI={setUI}
          ensure={ensure}
        />
      ),
    })

    return () => {
      if (timer) clearTimeout(timer)
      for (const stop of stops) stop()
      disposeSlot()
    }
  },
})
