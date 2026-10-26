# AGENTS.md — sitepilot

Personal OSS project (OhanaeL). Bun workspaces monorepo; **not** a General-Magick-Industries repo.

## Layout
- `packages/core` — `@sitepilot/core`, vanilla TS. Everything else builds on it.
- `packages/react` — provider/hook/widget. Peer-depends on core + react.
- `packages/server` — fetch-standard proxy handler. No runtime deps.
- `packages/computer` — optional computer-use plugin (frame + coordinate actions).
- `examples/cloudflare-worker` — the static-site backend: `createPilotHandler` on a Worker with `allowOrigins`.
- `examples/vite-react` — demo; the proxy is mounted inside Vite's dev server (`vite.config.ts`). Needs a `.env` (see `.env.example`); never commit it.

## Commands
```bash
bun install
bun run build
bun run test        # bun:test + happy-dom, preload in test/setup.ts (stubs getBoundingClientRect/scrollIntoView/ResizeObserver)
bun run typecheck
bun run lint        # biome ci: format + lint check, as CI runs it; `bun run format` fixes
bun run dev:example
```

## Releasing
- Record a change with `bunx changeset` in the PR that makes it. The four packages are one `fixed` group, so they always share a version.
- To release: `bunx changeset version` (bumps versions, writes CHANGELOGs), commit, `bun run build`, then `bun publish` inside each package. Use `bun publish`, not `npm publish`: bun rewrites the `workspace:^` peer ranges to `^x.y.z`, npm would ship the `workspace:` protocol.
- Nothing is on npm yet. Changes since `0.1.0` are recorded too, so the first `bunx changeset version` takes the group to `0.2.0`. The first publish needs the `@sitepilot` npm org.

## Load-bearing conventions
- **Attribute contract lives in `packages/core/src/attrs.ts`** and is documented in the README table. Renaming an attribute is a breaking change for every consumer's markup.
- **Ordinal keys are computed in one namespace across both tiers** (`withKeys` in `dom.ts`); the tier scans, `scanAll` and `resolveKey` must all share that path or the prompt and the resolver disagree on a key.
- **Workspace packages resolve `@sitepilot/core` from source** through the `@sitepilot/source` export condition (`customConditions` in `tsconfig.base.json`; `bun run test` passes `--conditions`). Build order doesn't matter and nothing reads a stale `dist/`. Plain `bun test` still resolves `dist/`.
- **Tool consent is enforced in `pilot.ts`, not in tools**: actions must be in `enabledTools`; utilities need at least one enabled action.
- **`tools`/`user`/`context` are getters read every round**; the React provider feeds them through a ref so the pilot is created once per `transport`/`plugins`/`prompt`/`systemPrompt` and still sees live state.
- **Two prompt modes.** `prompt: "client"` builds the system message in the browser; `"server"` sends a `sitepilot` context field and no system message, and `@sitepilot/server` renders it (`cleanContext` re-validates it — treat it as untrusted). `@sitepilot/core/prompt` is the pure subpath the server imports; keep it free of DOM/driver.js imports.
- **Manifest rules are virtual**: `manifest.ts` holds module-level rules; `dom.ts`/`events.ts` consult them beside the attributes. Never stamp attributes onto matched nodes. One invalid selector would poison the combined selector, so `setManifest` drops those up front.
- **Never wait on `requestAnimationFrame` alone** — background tabs pause it; `scrollIntoViewSettled` keeps a `setTimeout` backstop.
- **Test preload restores Bun's native `Request`/`Response`/`Headers`/`fetch`** after happy-dom registers; happy-dom's `Request` drops forbidden headers like `Origin`, which the server's CORS tests need.
- **Tool attachments are turn-scoped** (`stripEphemeralMedia`). Do not persist images across user turns.
- **driver.js CSS is inlined** at build (`loader: {".css": "text"}` + `noExternal`) and injected once by `ensureStyles()`. Consumers need no CSS import.
- **Widget z-index is 10002**: above driver's overlay (10000) and click ring (10001), below its popover (1e9), so captions render over the panel.
- Wire format is OpenAI chat completions end to end; keep `@sitepilot/server` a passthrough that validates, never one that reshapes. The one exception is the optional `router` (`jevRouter`, `src/jev.ts`): it may answer a round itself, and must then answer in that same completion shape.
- **`jevRouter` is stateless and keys on tool-call ids.** Jev's calls are `jev_`-prefixed. Any other assistant message in the current turn (since the last string user message) means the LLM owns the rest of that turn. Jev picks values and never writes text: a tool qualifies only when every required argument is a `target` element key, a string `enum` or a boolean. Its one image path: an empty `computer` batch ("look"), at most once per turn. The frame is used only in the round right after that look, because the screen goes stale after Jev's next action.
- Git identity for this repo is the OhanaeL account (set locally); no co-author trailer and no AI attribution lines.
