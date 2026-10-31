import { Rpc } from "@opencode/plugin/rpc"

/**
 * Shared RPC contract between the server part (which measures assembled
 * prompts) and the TUI part (which renders the sidebar panel).
 */
export const ContextBreakdown = Rpc.define({
  id: "contextSidebar",
  methods: {
    breakdown: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
        },
        required: ["sessionID"],
        additionalProperties: false,
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
                tokens: { type: "number" },
              },
              required: ["key", "tokens"],
              additionalProperties: false,
            },
          },
          mcp: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                tools: { type: "number" },
                tokens: { type: "number" },
              },
              required: ["name", "tools", "tokens"],
              additionalProperties: false,
            },
          },
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
          "mcp",
        ],
        additionalProperties: false,
      },
    },
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
        },
        required: ["sessionID"],
        additionalProperties: false,
      },
    },
  },
})
