// src/index.ts
import { Plugin } from "@opencode/plugin";

// rpc.js
import { Rpc } from "@opencode/plugin/rpc";
var ContextBreakdown = Rpc.define({
  id: "contextSidebar",
  methods: {
    breakdown: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" }
        },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          pending: { type: "boolean" },
          model: { type: "string" },
          limit: { type: "number" },
          used: { type: "number" },
          buffer: { type: "number" },
          updated: { type: "number" },
          note: { type: "string" },
          parts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                key: { type: "string" },
                tokens: { type: "number" }
              },
              required: ["key", "tokens"],
              additionalProperties: false
            }
          },
          mcp: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                tools: { type: "number" },
                tokens: { type: "number" }
              },
              required: ["name", "tools", "tokens"],
              additionalProperties: false
            }
          }
        },
        required: [
          "sessionID",
          "pending",
          "model",
          "limit",
          "used",
          "buffer",
          "updated",
          "note",
          "parts",
          "mcp"
        ],
        additionalProperties: false
      }
    }
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" }
        },
        required: ["sessionID"],
        additionalProperties: false
      }
    }
  }
});

// src/estimate.ts
var CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/g;
function estimateText(text) {
  if (!text) return 0;
  const cjk = (text.match(CJK) ?? []).length;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}
var SKIP_KEYS = /* @__PURE__ */ new Set(["metadata", "native", "providerMetadata"]);
function estimateValue(value, seen = /* @__PURE__ */ new Set()) {
  if (value === null || value === void 0) return 0;
  if (typeof value === "string") return estimateText(value);
  if (typeof value === "number" || typeof value === "boolean") return 1;
  if (typeof value !== "object") return 0;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return 0;
  if (Array.isArray(value)) {
    let total2 = 0;
    for (const item of value) total2 += estimateValue(item, seen);
    return total2;
  }
  let total = 0;
  for (const [key, item] of Object.entries(value)) {
    if (SKIP_KEYS.has(key)) continue;
    total += estimateValue(item, seen);
  }
  return total;
}

// src/index.ts
var EMPTY_RAW = {
  mcp: 0,
  tools: 0,
  system: 0,
  skills: 0,
  messages: 0
};
function promptUsage(tokens) {
  return tokens.input + tokens.cache.read + tokens.cache.write;
}
function lastUsage(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type !== "assistant" || !message.tokens) continue;
    const tokens = message.tokens;
    const cache = tokens.cache ?? { read: 0, write: 0 };
    return {
      tokens: {
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cache: { read: cache.read ?? 0, write: cache.write ?? 0 }
      },
      model: message.model
    };
  }
  return void 0;
}
function findModel(ctx, ref) {
  if (!ref) return void 0;
  return ctx.model.list().then(
    (result) => result.data.find(
      (model) => model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id)
    )
  );
}
async function loadSnapshot(ctx, sessionID) {
  try {
    const value = await ctx.storage.get(`snapshot/${sessionID}`);
    if (!value || typeof value !== "object") return void 0;
    const snapshot = value;
    if (typeof snapshot.sessionID !== "string" || typeof snapshot.raw !== "object") return void 0;
    if (Object.keys(EMPTY_RAW).some((key) => typeof snapshot.raw[key] !== "number")) return void 0;
    if (!Array.isArray(snapshot.mcp)) return void 0;
    return snapshot;
  } catch {
    return void 0;
  }
}
async function measure(ctx, event, skillText, mcpServers, mcpCatalog) {
  const systemText = event.system.map((part) => part.text).join("\n");
  const skills = estimateText(await skillText());
  const system = Math.max(0, estimateText(systemText) - skills);
  const groups = /* @__PURE__ */ new Map();
  const servers = await mcpServers();
  let tools = 0;
  for (const [name, definition] of Object.entries(event.tools)) {
    const tokens = estimateText(name) + estimateText(definition.description ?? "") + estimateValue(definition.input);
    const owner = mcpOwner(name, servers);
    if (!owner) {
      tools += tokens;
      continue;
    }
    const group = groups.get(owner) ?? { name: owner, tools: 0, tokens: 0 };
    group.tools += 1;
    group.tokens += tokens;
    groups.set(owner, group);
  }
  const mcpGroups = [...groups.values()].sort((left, right) => right.tokens - left.tokens);
  const promptMcp = mcpGroups.reduce((sum, group) => sum + group.tokens, 0);
  const catalog = await mcpCatalog();
  const mcp = promptMcp > 0 ? promptMcp : catalog.tokens;
  const messages = estimateValue(event.messages);
  return {
    sessionID: event.sessionID,
    model: event.model,
    raw: { ...EMPTY_RAW, mcp, tools, system, skills, messages },
    mcp: mcpGroups,
    at: Date.now()
  };
}
function mcpOwner(tool, servers) {
  let owner;
  for (const server of servers) {
    const normalized = server.replace(/[^a-zA-Z0-9]+/g, "_");
    const prefixes = [
      `${server}__`,
      `${server}_`,
      `${server}.`,
      `mcp__${normalized}__`,
      `mcp_${normalized}_`
    ];
    if (tool !== server && !prefixes.some((prefix) => tool.startsWith(prefix))) continue;
    if (!owner || server.length > owner.length) owner = server;
  }
  return owner;
}
var index_default = Plugin.define({
  id: "context-sidebar",
  async setup(ctx) {
    const snapshots = /* @__PURE__ */ new Map();
    let skillCache = { at: 0, text: "" };
    let serverCache = { at: 0, names: [] };
    const skillText = async () => {
      if (Date.now() - skillCache.at < 6e4) return skillCache.text;
      try {
        const skills = await ctx.skill.list();
        skillCache = {
          at: Date.now(),
          text: skills.data.map((skill) => `${skill.name}
${skill.description ?? ""}`).join("\n")
        };
      } catch {
        skillCache = { at: Date.now(), text: skillCache.text };
      }
      return skillCache.text;
    };
    const mcpServers = async () => {
      if (Date.now() - serverCache.at < 3e4) return serverCache.names;
      try {
        const servers = await ctx.mcp.list();
        serverCache = { at: Date.now(), names: servers.data.map((server) => server.name) };
      } catch {
        serverCache = { at: Date.now(), names: serverCache.names };
      }
      return serverCache.names;
    };
    let catalogCache = { at: 0, tokens: 0, tools: 0 };
    const mcpCatalog = async () => {
      if (Date.now() - catalogCache.at < 3e5) return catalogCache;
      try {
        const tools = await ctx.tool.list();
        const servers = await mcpServers();
        let tokens = 0;
        let count = 0;
        for (const tool of tools) {
          if (!mcpOwner(tool.id, servers)) continue;
          count += 1;
          tokens += estimateText(tool.id) + estimateText(tool.description ?? "") + estimateValue(tool.input);
        }
        catalogCache = { at: Date.now(), tokens, tools: count };
      } catch {
        catalogCache = { at: 0, tokens: catalogCache.tokens, tools: catalogCache.tools };
      }
      return catalogCache;
    };
    const registration = await ctx.rpc.register(ContextBreakdown, {
      breakdown: async (input) => {
        const { sessionID } = input;
        let messages = [];
        try {
          messages = await ctx.session.context({ sessionID });
        } catch {
          return {
            sessionID,
            pending: true,
            model: "",
            limit: 2e5,
            used: 0,
            buffer: 1e4,
            updated: Date.now(),
            note: "No context yet",
            parts: [],
            mcp: []
          };
        }
        const usage = lastUsage(messages);
        const snapshot = snapshots.get(sessionID) ?? await loadSnapshot(ctx, sessionID);
        if (snapshot) snapshots.set(sessionID, snapshot);
        const catalog = snapshot && snapshot.raw.mcp === 0 ? await mcpCatalog() : void 0;
        const raw = snapshot ? { ...snapshot.raw, mcp: snapshot.raw.mcp > 0 ? snapshot.raw.mcp : catalog?.tokens ?? 0 } : void 0;
        const ref = snapshot?.model ?? usage?.model;
        const model = await findModel(ctx, ref);
        const limit = model?.limit.context ?? 2e5;
        const reserve = Math.round(limit * 0.05);
        const prompt = usage ? promptUsage(usage.tokens) : 0;
        const output = usage?.tokens.output ?? 0;
        const rawTotal = raw ? totalRaw(raw) : 0;
        const scale = rawTotal > 0 && prompt > 0 ? prompt / rawTotal : 1;
        const parts = raw ? Object.keys(EMPTY_RAW).map((key) => ({
          key,
          tokens: Math.max(0, Math.round(raw[key] * scale))
        })) : [];
        if (parts.length > 0) {
          const messagesPart = parts.find((part) => part.key === "messages");
          const sum = parts.reduce((total, part) => total + part.tokens, 0);
          if (messagesPart) messagesPart.tokens += Math.max(0, prompt - sum) + output;
        }
        const used = parts.length > 0 ? parts.reduce((total, part) => total + part.tokens, 0) : prompt + output;
        const clamped = Math.min(limit, Math.max(0, used));
        const buffer = Math.min(reserve, Math.max(0, limit - clamped));
        const empty = !snapshot;
        const viewParts = parts.length > 0 ? parts : clamped > 0 ? [{ key: "messages", tokens: clamped }] : [];
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
            tokens: Math.max(0, Math.round(group.tokens * scale))
          }))
        };
      }
    });
    const hook = await ctx.session.hook("context", async (event) => {
      try {
        const snapshot = await measure(ctx, event, skillText, mcpServers, mcpCatalog);
        snapshots.set(event.sessionID, snapshot);
        await ctx.storage.set(`snapshot/${event.sessionID}`, JSON.parse(JSON.stringify(snapshot)));
        await registration.events.emit("updated", { sessionID: event.sessionID });
      } catch (error) {
        console.error("[context-sidebar] failed to measure prompt", error);
      }
    });
    return async () => {
      await hook.dispose();
      await registration.dispose();
    };
  }
});
function totalRaw(raw) {
  return raw.mcp + raw.tools + raw.system + raw.skills + raw.messages;
}
export {
  index_default as default
};
