# AGENTS.md — sitepilot

Personal OSS project (OhanaeL). Bun workspaces monorepo; **not** a General-Magick-Industries repo.

## Layout
- `packages/core` — `@sitepilot/core`, vanilla TS. Everything else builds on it.
- `packages/react` — provider/hook/widget. Peer-depends on core + react.
- `packages/server` — fetch-standard proxy handler. No runtime deps.
- `packages/computer` — optional computer-use plugin (frame + coordinate actions).
- `examples/vite-react` — demo; the proxy is mounted inside Vite's dev server (`vite.config.ts`). Needs a `.env` (see `.env.example`); never commit it.

## Commands
```bash
bun install
bun run build       # core must be built before react/computer/example typecheck — they resolve @sitepilot/core via the workspace symlink to dist/
bun test            # bun:test + happy-dom, preload in test/setup.ts (stubs getBoundingClientRect/scrollIntoView/ResizeObserver)
bun run typecheck
bun run dev:example
```

## Load-bearing conventions
- **Attribute contract lives in `packages/core/src/attrs.ts`** and is documented in the README table. Renaming an attribute is a breaking change for every consumer's markup.
- **Ordinal keys are computed in one namespace across both tiers** (`withKeys` in `dom.ts`); `scanAll` and `resolveKey` must share that path or targeting silently misses.
- **Tool consent is enforced in `pilot.ts`, not in tools**: actions must be in `enabledTools`; utilities need at least one enabled action.
- **`tools`/`user`/`context` are getters read every round**; the React provider feeds them through a ref so the pilot is created once per `transport`/`plugins`/`prompt`/`systemPrompt` and still sees live state.
- **Two prompt modes.** `prompt: "client"` builds the system message in the browser; `"server"` sends a `sitepilot` context field and no system message, and `@sitepilot/server` renders it (`cleanContext` re-validates it — treat it as untrusted). `@sitepilot/core/prompt` is the pure subpath the server imports; keep it free of DOM/driver.js imports.
- **Tool attachments are turn-scoped** (`stripEphemeralMedia`). Do not persist images across user turns.
- **driver.js CSS is inlined** at build (`loader: {".css": "text"}` + `noExternal`) and injected once by `ensureStyles()`. Consumers need no CSS import.
- **Widget z-index is 10002**: above driver's overlay (10000) and click ring (10001), below its popover (1e9), so captions render over the panel.
- Wire format is OpenAI chat completions end to end; keep `@sitepilot/server` a passthrough that validates, never one that reshapes.
- Git identity for this repo is the OhanaeL account (set locally); co-author trailer is `linn-dev-gmi`, no AI attribution lines.
