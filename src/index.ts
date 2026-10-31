import { Plugin } from "@opencode/plugin"
import { ContextBreakdown } from "../rpc.js"
import { estimateText, estimateValue } from "./estimate.js"

type Context = Parameters<Parameters<typeof Plugin.define>[0]["setup"]>[0]
type PartKey = "mcp" | "tools" | "system" | "skills" | "messages"
type Usage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}
type ModelRef = { providerID: string; id: string }
type Snapshot = {
  sessionID: string
  model: ModelRef
  raw: Record<PartKey, number>
  mcp: Array<{ name: string; tools: number; tokens: number }>
  at: number
}
type McpGroup = { name: string; tools: number; tokens: number }

const EMPTY_RAW: Record<PartKey, number> = {
  mcp: 0,
  tools: 0,
  system: 0,
  skills: 0,
  messages: 0,
}

function promptUsage(tokens: Usage): number {
  return tokens.input + tokens.cache.read + tokens.cache.write
}

function lastUsage(messages: readonly any[]): { tokens: Usage; model?: ModelRef } | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.type !== "assistant" || !message.tokens) continue
    const tokens = message.tokens as Partial<Usage>
    const cache = tokens.cache ?? { read: 0, write: 0 }
    return {
      tokens: {
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cache: { read: cache.read ?? 0, write: cache.write ?? 0 },
      },
      model: message.model,
    }
  }
  return undefined
}

function findModel(ctx: Context, ref: ModelRef | undefined) {
  if (!ref) return undefined
  return ctx.model.list().then((result) =>
    result.data.find(
      (model) => model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id),
    ),
  )
}

async function loadSnapshot(ctx: Context, sessionID: string): Promise<Snapshot | undefined> {
  try {
    const value = await ctx.storage.get(`snapshot/${sessionID}`)
    if (!value || typeof value !== "object") return undefined
    const snapshot = value as unknown as Snapshot
    if (typeof snapshot.sessionID !== "string" || typeof snapshot.raw !== "object") return undefined
    if (Object.keys(EMPTY_RAW).some((key) => typeof snapshot.raw[key as PartKey] !== "number")) return undefined
    if (!Array.isArray(snapshot.mcp)) return undefined
    return snapshot
  } catch {
    return undefined
  }
}

async function measure(
  ctx: Context,
  event: {
    sessionID: string
    model: ModelRef
    system: ReadonlyArray<{ type: "text"; text: string }>
    messages: ReadonlyArray<unknown>
    tools: Record<string, { description: string; input: unknown }>
  },
  skillText: () => Promise<string>,
  mcpServers: () => Promise<string[]>,
  mcpCatalog: () => Promise<{ tokens: number; tools: number }>,
): Promise<Snapshot> {
  const systemText = event.system.map((part) => part.text).join("\n")
  const skills = estimateText(await skillText())
  const system = Math.max(0, estimateText(systemText) - skills)

  const groups = new Map<string, McpGroup>()
  const servers = await mcpServers()
  let tools = 0

  for (const [name, definition] of Object.entries(event.tools)) {
    const tokens =
      estimateText(name) + estimateText(definition.description ?? "") + estimateValue(definition.input)
    const owner = mcpOwner(name, servers)
    if (!owner) {
      tools += tokens
      continue
    }
    const group = groups.get(owner) ?? { name: owner, tools: 0, tokens: 0 }
    group.tools += 1
    group.tokens += tokens
    groups.set(owner, group)
  }

  const mcpGroups = [...groups.values()].sort((left, right) => right.tokens - left.tokens)
  const promptMcp = mcpGroups.reduce((sum, group) => sum + group.tokens, 0)
  // Code Mode exposes MCP tools through `execute` instead of sending every
  // schema. Fall back to the registered catalog so the category has a real
  // size instead of zero.
  const catalog = await mcpCatalog()
  const mcp = promptMcp > 0 ? promptMcp : catalog.tokens
  const messages = estimateValue(event.messages)

  return {
    sessionID: event.sessionID,
    model: event.model,
    raw: { ...EMPTY_RAW, mcp, tools, system, skills, messages },
    mcp: mcpGroups,
    at: Date.now(),
  }
}

function mcpOwner(tool: string, servers: readonly string[]): string | undefined {
  let owner: string | undefined
  for (const server of servers) {
    const normalized = server.replace(/[^a-zA-Z0-9]+/g, "_")
    const prefixes = [
      `${server}__`,
      `${server}_`,
      `${server}.`,
      `mcp__${normalized}__`,
      `mcp_${normalized}_`,
    ]
    if (tool !== server && !prefixes.some((prefix) => tool.startsWith(prefix))) continue
    if (!owner || server.length > owner.length) owner = server
  }
  return owner
}

export default Plugin.define({
  id: "context-sidebar",
  async setup(ctx) {
    const snapshots = new Map<string, Snapshot>()
    let skillCache = { at: 0, text: "" }
    let serverCache = { at: 0, names: [] as string[] }

    const skillText = async () => {
      if (Date.now() - skillCache.at < 60_000) return skillCache.text
      try {
        const skills = await ctx.skill.list()
        skillCache = {
          at: Date.now(),
          text: skills.data.map((skill) => `${skill.name}\n${skill.description ?? ""}`).join("\n"),
        }
      } catch {
        skillCache = { at: Date.now(), text: skillCache.text }
      }
      return skillCache.text
    }

    const mcpServers = async () => {
      if (Date.now() - serverCache.at < 30_000) return serverCache.names
      try {
        const servers = await ctx.mcp.list()
        serverCache = { at: Date.now(), names: servers.data.map((server) => server.name) }
      } catch {
        serverCache = { at: Date.now(), names: serverCache.names }
      }
      return serverCache.names
    }

    let catalogCache = { at: 0, tokens: 0, tools: 0 }
    const mcpCatalog = async () => {
      if (Date.now() - catalogCache.at < 300_000) return catalogCache
      try {
        const tools = await ctx.tool.list()
        const servers = await mcpServers()
        let tokens = 0
        let count = 0
        for (const tool of tools) {
          if (!mcpOwner(tool.id, servers)) continue
          count += 1
          tokens += estimateText(tool.id) + estimateText(tool.description ?? "") + estimateValue(tool.input)
        }
        catalogCache = { at: Date.now(), tokens, tools: count }
      } catch {
        catalogCache = { at: 0, tokens: catalogCache.tokens, tools: catalogCache.tools }
      }
      return catalogCache
    }

    const registration = await ctx.rpc.register(ContextBreakdown, {
      breakdown: async (input) => {
        const { sessionID } = input as { sessionID: string }
        let messages: readonly any[] = []
        try {
          messages = await ctx.session.context({ sessionID })
        } catch {
          return {
            sessionID,
            pending: true,
            model: "",
            limit: 200_000,
            used: 0,
            buffer: 10_000,
            updated: Date.now(),
            note: "No context yet",
            parts: [],
            mcp: [],
          }
        }
        const usage = lastUsage(messages)
        const snapshot = snapshots.get(sessionID) ?? (await loadSnapshot(ctx, sessionID))
        if (snapshot) snapshots.set(sessionID, snapshot)
        const catalog = snapshot && snapshot.raw.mcp === 0 ? await mcpCatalog() : undefined
        const raw = snapshot
          ? { ...snapshot.raw, mcp: snapshot.raw.mcp > 0 ? snapshot.raw.mcp : (catalog?.tokens ?? 0) }
          : undefined
        const ref = snapshot?.model ?? usage?.model
        const model = await findModel(ctx, ref)
        const limit = model?.limit.context ?? 200_000
        const reserve = Math.round(limit * 0.05)

        const prompt = usage ? promptUsage(usage.tokens) : 0
        const output = usage?.tokens.output ?? 0
        const rawTotal = raw ? totalRaw(raw) : 0
        const scale = rawTotal > 0 && prompt > 0 ? prompt / rawTotal : 1
        const parts: Array<{ key: PartKey; tokens: number }> = raw
          ? (Object.keys(EMPTY_RAW) as PartKey[]).map((key) => ({
              key,
              tokens: Math.max(0, Math.round(raw[key] * scale)),
            }))
          : []
        if (parts.length > 0) {
          const messagesPart = parts.find((part) => part.key === "messages")
          const sum = parts.reduce((total, part) => total + part.tokens, 0)
          if (messagesPart) messagesPart.tokens += Math.max(0, prompt - sum) + output
        }

        const used = parts.length > 0 ? parts.reduce((total, part) => total + part.tokens, 0) : prompt + output
        const clamped = Math.min(limit, Math.max(0, used))
        const buffer = Math.min(reserve, Math.max(0, limit - clamped))
        const empty = !snapshot
        const viewParts =
          parts.length > 0
            ? parts
            : clamped > 0
              ? [{ key: "messages" as PartKey, tokens: clamped }]
              : []

        return {
          sessionID,
          pending: empty,
          model: ref?.id ?? "",
          limit,
          used: clamped,
          buffer,
          updated: snapshot?.at ?? Date.now(),
          note: empty ? "Run a prompt to measure this session" : "",
          parts: viewParts,
          mcp: (snapshot?.mcp ?? []).map((group) => ({
            name: group.name,
            tools: group.tools,
            tokens: Math.max(0, Math.round(group.tokens * scale)),
          })),
        }
      },
    })

    const hook = await ctx.session.hook("context", async (event) => {
      try {
        const snapshot = await measure(ctx, event, skillText, mcpServers, mcpCatalog)
        snapshots.set(event.sessionID, snapshot)
        await ctx.storage.set(`snapshot/${event.sessionID}`, JSON.parse(JSON.stringify(snapshot)))
        await registration.events.emit("updated", { sessionID: event.sessionID })
      } catch (error) {
        console.error("[context-sidebar] failed to measure prompt", error)
      }
    })

    return async () => {
      await hook.dispose()
      await registration.dispose()
    }
  },
})

function totalRaw(raw: Record<PartKey, number>): number {
  return raw.mcp + raw.tools + raw.system + raw.skills + raw.messages
}
