import { transformFileSync } from "@babel/core"
import { build } from "esbuild"
import { mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const out = (path) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url))
mkdirSync(fileURLToPath(new URL("../dist", import.meta.url)), { recursive: true })

// Solid's JSX transform emits calls into the host-provided @opentui/solid
// runtime, which OpenCode resolves for TUI plugins.
const tui = transformFileSync(fileURLToPath(new URL("../src/tui.tsx", import.meta.url)), {
  babelrc: false,
  configFile: false,
  presets: [
    "@babel/preset-typescript",
    ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
  ],
})

if (!tui?.code) throw new Error("Babel produced no output for src/tui.tsx")
writeFileSync(out("tui.js"), tui.code)

// The server part is bundled so the host can resolve a plain JavaScript
// entrypoint, while OpenCode-provided packages stay external.
await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  outfile: out("index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  external: ["@opencode/*"],
  logLevel: "silent",
})

console.log("built dist/tui.js and dist/index.js")
