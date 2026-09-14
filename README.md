# sitepilot

**Annotate your DOM. Get an AI agent that can see it, point at it, click it, and fill it.**

Sitepilot adds an in-app assistant to any website with a handful of `data-` attributes. Nothing else changes: no registration hooks, no component wrappers, no framework lock-in. The DOM is the source of truth — an element exists for the agent exactly while it is marked and on screen.

```html
<button data-pilot="Create project button">+ New project</button>
<input  data-pilot="Search projects field" placeholder="Search…">
<li     data-pilot-item="Project card: Apollo">…</li>
```

```tsx
<SitepilotProvider transport={openaiTransport({ url: "/api/pilot" })}>
  <App />
  <SitepilotWidget />
</SitepilotProvider>
```

> "Where do I create a project?" → the button gets a spotlight.
> "Create a project called Dione" → the agent opens the dialog, types the name, and leaves the final **Create** click to the user.

Bring your own model: anything with an OpenAI-compatible chat-completions endpoint and tool calling (OpenAI, Anthropic via a proxy, LiteLLM, OpenRouter, Ollama…).

## Why this instead of a copilot framework

| | CopilotKit / Pillar | sitepilot |
|---|---|---|
| How the agent learns the UI | Register tools in code (`useFrontendTool`, `usePillarTool`) | **Annotate markup** with `data-pilot` — works with server-rendered HTML, htmx, Vue, Svelte, React… |
| "Show me where X is" | — | Built-in spotlight (driver.js) with click-to-advance |
| Agent knows what the user just did | — | Rolling buffer of recent clicks/inputs on marked elements |
| Prompt-size discipline | Yours to manage | Tiered visibility (ambient / on-demand items), hard caps, values clipped |
| Screenshots | Full-page pixels | **Only opted-in elements** are ever rendered into the frame |
| Backend | Runtime + protocol, or Django + Postgres + Redis + Hatchet | ~150-line fetch-standard proxy, or none |

## Packages

| Package | What it is |
|---|---|
| [`@sitepilot/core`](packages/core) | Vanilla TS. DOM scanning, key resolution, highlight/click/fill, user-event buffer, prompt builder, the client-driven tool loop, the plugin seam. No framework. |
| [`@sitepilot/react`](packages/react) | `SitepilotProvider`, `useSitepilot()`, and a drop-in `SitepilotWidget` (own CSS, themable via variables). |
| [`@sitepilot/server`](packages/server) | `createPilotHandler()` — a `(Request) => Response` proxy that keeps your key server-side, pins the model, and whitelists the body. Plus `toNodeListener()` for Express. |
| [`@sitepilot/computer`](packages/computer) | Optional computer-use plugin: one `computer` tool that runs an action batch by normalized coordinates and returns a **privacy-preserving frame** of the screen. Needs a vision model. |

## Quick start (React + Vite)

```bash
bun add @sitepilot/core @sitepilot/react @sitepilot/server
```

**1. Mount the proxy** (Next.js route handler shown; Hono, Bun.serve, Workers and Express work the same way):

```ts
// app/api/pilot/route.ts
import { createPilotHandler } from "@sitepilot/server";

export const POST = createPilotHandler({
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
  // baseURL: "https://litellm.example/v1",   any OpenAI-compatible server
  // systemPrompt: "You are the assistant for Acme.",
});
```

**2. Wrap your app** and drop in the widget:

```tsx
import { openaiTransport } from "@sitepilot/core";
import { SitepilotProvider, SitepilotWidget } from "@sitepilot/react";

const transport = openaiTransport({ url: "/api/pilot" });

export function Root() {
  return (
    <SitepilotProvider transport={transport}>
      <App />
      <SitepilotWidget title="Acme assistant" />
    </SitepilotProvider>
  );
}
```

**3. Annotate what the agent may see and touch.** Write the value as a label a person would say — it doubles as the key the model targets.

```tsx
import { mark, markItem, markRead, markContext } from "@sitepilot/react";

<button {...mark("Create project button")}>+ New project</button>
<input  {...mark("Search projects field")} />
<li     {...markItem(`Project card: ${p.name}`)}>…</li>
<section {...markRead(`Details: ${p.name}`)}>Owner: {p.owner}</section>
<main {...markContext("projects", "Acme Projects: where the user manages projects.")}>…</main>
```

Run the demo: `cp examples/vite-react/.env.example examples/vite-react/.env`, fill it in, then `bun install && bun run build && bun run dev:example`.

## The attribute contract

| Attribute | Tier | The model sees it… |
|---|---|---|
| `data-pilot="Save button"` | ambient | every turn — chrome, nav, form fields, dialog controls |
| `data-pilot-item="Project card: Acme"` | item | only when it calls `get_screen_elements` — lists can be long |
| `data-pilot-read` (alongside one of the above) | — | with the element's rendered text included, clipped to 600 chars |
| `data-pilot-context="projects"` + `data-pilot-context-description="…"` | — | as a sentence about what this area *is*; never a target. The innermost reachable marker wins, so a modal's context beats the page's |
| `data-pilot-panel` | — | never — the agent's own UI is excluded from every scan |

What the scan guarantees:

- **Only reachable elements are offered.** Anything inside `aria-hidden="true"` / `inert` (the page behind an open modal) is dropped, as is anything without a layout box.
- **Field values ride along** (`Search field: “acme”`) so the model sees state, not just labels — **never** for `type=password`.
- **Duplicate labels get ordinals** (`Project card #2`) in one namespace across both tiers, so a key always resolves to exactly one node.
- **Keys resolve fuzzily.** Models paraphrase; a unique normalized-containment match is accepted, a tiny key like "Search" is not.

## How a turn works

```
user text ─► collect screen (route, ambient elements, area, recent user events)
          ─► system prompt + history + tool specs ─► POST /api/pilot ─► model
          ◄─ tool_calls?  execute against the DOM, append `tool` results, loop (≤ 8 rounds)
          ◄─ text          render, done
```

The loop is **client-driven**: the browser owns the DOM, so it re-scans the screen between rounds and the model always plans against what is actually there now. The wire format is plain OpenAI chat completions, which is why any compatible endpoint works without `@sitepilot/server`.

Built-in tools (each is a **consent switch** the user can flip in the widget):

| Tool | Does |
|---|---|
| `highlight_element` | Spotlight + caption. If the user clicks the highlighted element, the agent receives *"I clicked …"* as the next turn — guided walkthroughs fall out of this. |
| `click_element` | Clicks on the user's behalf. The prompt forbids final submit/confirm/delete buttons. |
| `fill_field` | Sets the value through the native setter + `input` event, so React/Vue controlled inputs update. |
| `get_screen_elements` | Look closer: returns the `item` tier. Rides along whenever any action is enabled. |

## Computer-use plugin (`@sitepilot/computer`)

Modelled on Anthropic-style computer use, with one difference: **the frame never contains anything you didn't opt in.**

```tsx
import { computerPlugin } from "@sitepilot/computer";

<SitepilotProvider transport={transport} plugins={[computerPlugin()]}>
```

The agent gets one more tool, `computer`, that takes a batch of up to 8 actions and returns a frame:

```json
{ "actions": [ { "do": "click", "x": 650, "y": 50 }, { "do": "type", "text": "acme" }, { "do": "wait", "ms": 200 } ] }
```

- Coordinates are normalized `0..999` on both axes, so scaling the frame for token budget can never desync a click.
- A click resolves to the **opted-in element under that point**; a click on blank space fails and stops the batch. `type` goes into the field clicked last.
- The reply reports `executed` vs `requested` (a batch is never all-or-nothing — a click cannot be rolled back) plus every element's normalized rect, and the frame arrives as an image attached to the same round.
- The frame is rendered by sitepilot onto a blank canvas: each marked element becomes a labelled box at its true position. Pass `renderElement` (e.g. `html-to-image`'s `toCanvas`) to composite each element's real pixels instead — still nothing outside the marked boxes.
- Frames are turn-scoped: they are stripped from history before the next user message, so requests do not grow with the conversation.

Needs a vision-capable model. The plugin adds its own operating brief to the system prompt ("look before you act", "look again after").

## Writing a plugin

A plugin is `{ name, tools?, brief? }`. A tool is an OpenAI function spec plus `execute(args, ctx)` returning a string or `{ content, attachments }`. `kind: "action"` tools are consent-gated; `kind: "utility"` tools ride along whenever any action is enabled.

```ts
const clock: PilotPlugin = {
  name: "clock",
  tools: [{
    kind: "utility",
    spec: { type: "function", function: { name: "get_local_time", description: "The user's local time.", parameters: { type: "object", properties: {} } } },
    execute: async () => new Date().toString(),
  }],
};
```

## Headless use (no React)

```ts
import { createPilot, openaiTransport } from "@sitepilot/core";

const pilot = createPilot({ transport: openaiTransport({ url: "/api/pilot" }) });
pilot.subscribe(() => render(pilot.getState()));
pilot.send("where is the search box?");
```

## Security notes

- The proxy strips everything but `messages` and `tools`, pins `model`, caps message count and body size, and rejects `image_url` parts that are not `data:image/…` or `https://`. Add your own auth/rate-limit in front of it — it is deliberately unopinionated about sessions.
- The browser builds the system prompt. That is by design (the DOM is there), and it is not a secret; the key is. `systemPrompt` on the server is prepended and cannot be removed by the client.
- Consent is enforced twice: disabled tools are not advertised, and a call to one is refused even if the model invents it.

## Development

```bash
bun install
bun run build       # all packages (core first — the others resolve it through the workspace link)
bun test            # happy-dom; layout is stubbed in test/setup.ts
bun run typecheck
```

MIT © Ohanael
