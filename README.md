# Context sidebar for OpenCode

A local OpenCode V2 plugin that shows how the current context window is spent.
The panel appears in the session sidebar and lists token usage per prompt
component with a coloured usage bar.

## What it shows

| Row | Meaning |
| --- | --- |
| MCP tools | Tool schemas that came from MCP servers |
| System tools | Built-in tool schemas |
| System prompt | OpenCode instructions, AGENTS.md, environment |
| Skills | Skill names and descriptions included in the prompt |
| Messages | Conversation, tool calls, tool results, and the latest output |
| Autocompact buffer | 5% of the model context reserved before compaction |
| Free space | Context still available |

The header shows the percentage used and `used / limit`. The bar uses the same
colours as the rows. Click the `Context` header to collapse the panel; the
collapsed header shows the used percentage.

## How it works

The plugin has two parts:

- `src/index.ts` runs on the server. It hooks the assembled model request
  (`session.hook("context")`), estimates the size of each component, and
  rescales the estimates so they add up to the provider-reported prompt tokens.
  Snapshots are persisted in plugin storage so they survive plugin reloads.
- `src/tui.tsx` renders the `sidebar.content` slot. It calls the server part
  over RPC and refreshes after each turn.

Token counts for components other than `Messages` are estimates. The total
comes from the provider (input plus cache read/write), so the split is scaled to
that exact number. When Code Mode keeps MCP schemas behind the `execute` tool,
the plugin measures the registered MCP tool catalog and folds it into the MCP
share instead of showing zero.

## Install

The plugin is auto-discovered from the global plugin directory:

```
~/.config/opencode/plugins/context-sidebar/
```

No `opencode.json` entry is needed. Restart OpenCode once if the sidebar does
not appear after the first load.

## Commands

- `/context` or the palette command `Context: show token usage` shows a compact
  usage summary in a toast.
- `Context: refresh sidebar` forces a refresh of the current session.

## Development

```sh
npm install
npm run typecheck
npm run build
```

`npm run build` compiles the Solid TUI into `dist/tui.js` and bundles the server
part into `dist/index.js`. OpenCode resolves `@opencode/*` and `@opentui/*` from
its own runtime, so they stay external to the bundle.
