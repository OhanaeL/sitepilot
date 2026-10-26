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
| `data-pilot-hint="Opens the dialog. Pro plan only."` (alongside one of the above) | — | as hidden guidance after the label: what it does, when to use it, caveats. The user never sees it |
| `data-pilot-context="projects"` + `data-pilot-context-description="…"` | — | as a sentence about what this area *is*; never a target. The innermost reachable marker wins, so a modal's context beats the page's |
| `data-pilot-panel` | — | never — the agent's own UI is excluded from every scan |

What the scan guarantees:

- **Only reachable elements are offered.** Anything inside `aria-hidden="true"` / `inert` (the page behind an open modal) is dropped, as is anything without a layout box.
- **Field values ride along** (`Search field: “acme”`) so the model sees state, not just labels — **never** for `type=password`.
- **Duplicate labels get ordinals** (`Project card #2`) in one namespace across both tiers, so a key always resolves to exactly one node.
- **Keys resolve fuzzily.** Models paraphrase; a unique normalized-containment match is accepted, a tiny key like "Search" is not.

## Keep the markup clean: `pilot.json`

You don't have to touch your components at all. A manifest maps CSS selectors to labels, tiers, hints and area context, and the scanner reads it virtually — nothing is written to the DOM, so framework re-renders can't lose it:

```json
{
  "elements": [
    { "selector": ".btn-new-project", "label": "Create project button", "hint": "Opens the New project dialog." },
    { "selector": ".project-card",    "label": "Project card: {text:.title}", "tier": "item", "hint": "Click opens its details." },
    { "selector": "nav a",            "label": "{text} nav link" },
    { "selector": "#search",          "label": "Search field" }
  ],
  "areas": [
    { "selector": "main.projects", "topic": "projects", "description": "The projects list." }
  ],
  "hints": { "Settings nav link": "Account settings: display name, email, password." },
  "systemPrompt": "You are the guide to Acme…"
}
```

```tsx
<SitepilotProvider manifest="/pilot.json" …>        // a URL, or the object itself
```

Label templates fill per matched element: `{text}`, `{text:.title}` (a descendant's text), `{attr:data-id}`, `{value}`, `{placeholder}`, `{href}`, `{alt}`, `{title}`. Attributes and manifest rules coexist: an element's own `data-pilot` label wins over a template, and either source can supply the hint. Invalid selectors are skipped with a console warning. `send()` waits for a URL manifest to load; a failed load shows up in `state.error` and the pilot carries on with attributes only.

The manifest is fetched by the browser, so it is public — keep private guidance in the server's `prompt.hints`.

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

### What the AI sees

The widget's eye button (`showSeenToggle`, on by default) outlines every element the model is sent, from the same scan, keys and cap as the prompt: solid for the `ambient` tier sent every message, dashed for the `item` tier it can pull on request (only while an action is enabled). The outline is set on the element itself, so the page's own layers cover it. Where the model is sent an element the user can't see (covered by another layer, clipped by a scrolling container, or transparent), a hatched red box is drawn on top instead. Elements past `scan.maxElements` (default 20) get no outline, because the model never receives them. Headless: `const hide = pilot.showSeen()`.

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

## Customizing everything

Every string the model sees and every tool it can call is yours to change. All of these are `createPilot` options, and `<SitepilotProvider>` takes the same props.

### Your own tools

```tsx
import { defineTool } from "@sitepilot/react";

const countProjects = defineTool<{ status?: "active" | "paused" }>({
  name: "count_projects",
  description: "How many projects the user has, optionally by status.",
  parameters: { type: "object", properties: { status: { type: "string", enum: ["active", "paused"] } } },
  kind: "utility",                 // "action" (default) needs consent; "utility" rides along
  execute: ({ status }) => `${projects.filter((p) => !status || p.status === status).length} projects.`,
});

<SitepilotProvider tools={[countProjects]} …>
```

Tools are read every round, so an inline `defineTool` whose closure reads component state stays fresh — no memoisation needed. `execute` may return a string or `{ content, attachments }` (images the model sees this round). `ctx` gives you the current screen, the user, the strings table, and `activity()` for a transcript line.

### Hidden per-element guidance (hints)

A label says *what* an element is; a hint tells the model *how to think about it*, invisibly:

```tsx
<button {...mark("Create project button", {
  hint: "Opens the New project dialog. Free plans are capped at 5 projects — if they already have 5, say so instead of clicking.",
})}>
```

That renders into the inventory as `- Create project button: Create project button — Opens the New project dialog. Free plans…`, and into `get_screen_elements` results the same way. Plain HTML: `data-pilot-hint="…"`. Clipped at 400 chars.

Attributes live in the DOM, so anyone can read them. For guidance you'd rather keep private, key it by label instead:

```ts
// client mode
createPilot({ hints: { "Create project button": "Pro plan only.", "Project card": "Click opens its details." } })
// server mode — never leaves the server
createPilotHandler({ prompt: { hints: { "Password field": "NEVER read or fill this. Tell the user to change it themselves." } } })
```

Keys match the label with or without an ordinal (`"Project card"` covers `Project card #2`); a function `(element) => string | undefined` works too. DOM hints and keyed hints merge.

### The built-ins

```ts
builtinTools: false                                   // none — bring your own
builtinTools: { click_element: false }                // drop one
builtinTools: { highlight_element: { description: "Point at an element…" } }   // reword one
enabledTools: ["highlight_element"]                   // runtime consent list (the widget's toggles drive this)
```

### Prompt text

| Option | What it changes |
|---|---|
| `systemPrompt` | The base instructions (replaces `DEFAULT_SYSTEM_PROMPT`) |
| `promptOptions.renderScreen` | The `CURRENT SCREEN` block — render the element list any way you like |
| `promptOptions.renderUser` / `maxEmbeddedElements` / `briefs` | The user block, the element cap, whether plugin briefs are included |
| `context` | Per-turn app facts: `` () => `Plan: ${plan}. Cart: ${items} items.` `` |
| `user` | `{ id, name, ...anything }` → rendered as `ABOUT THE USER`; `id` also rides as OpenAI's `user` field |
| `strings` | Every tool-result string, transcript line and the synthetic `I clicked "…"` turn. Partial override, e.g. `` { clicked: (k) => `OK: ${k}`, activity: { highlighted: (k) => `👉 ${k}` } } `` |

### Keeping your wording off the client (`prompt: "server"`)

In the default `client` mode the browser composes the system prompt, so anyone can read it in devtools. Flip the pilot to **server mode** and it sends only a structured `sitepilot` context (screen, user, app facts, plugin briefs) with no system message at all; `@sitepilot/server` renders the prompt on the server:

```tsx
// browser
<SitepilotProvider prompt="server" user={{ id: session.userId, name: session.name }} …>
```

```ts
// server
createPilotHandler({
  apiKey, model,
  prompt: {
    system: "You are Pip, the Acme assistant. …",            // never leaves the server
    extra: (ctx, req) => `Plan: ${await planFor(req)}`,       // server-only facts per request
    renderScreen: (screen) => …,                             // optional
  },
  toolDescriptions: { click_element: "…" },                 // rewrite any advertised description, both modes
  systemPrompt: "…",                                         // always prepended, both modes
});
```

The tool *result* strings still come from the browser (they're produced where the tool runs); use `strings` for those.

### A fast brain in front of the LLM (`router`)

Most requests to an in-app agent are "where is X" or "open X": one highlight or one click, no words needed. `jevRouter` puts [TypeSafe](https://docs.typesafe.ai)'s Jev in front of the LLM. Each round, Jev decides whether it can run the step itself (~0.3 s) or whether the request needs the LLM:

```ts
import { createPilotHandler, jevRouter } from "@sitepilot/server";

createPilotHandler({
  apiKey, model,
  router: jevRouter({ apiKey: process.env.TYPESAFE_API_KEY! }),
});
```

- **Jev only picks, it never writes.** It runs a tool only when every required argument is an element `target`, a string `enum` or a boolean, so `fill_field` (free text) always goes to the LLM. By default it may call only `highlight_element` and `click_element`; drop `click_element` from `tools` if you'd rather Jev never act on the page unsupervised. Opt other tools in with `tools: [...]`, but only ones whose effect the user can see, because Jev's closing line is a fixed `reply` ("Here it is." / "Done.").
- **It loops, then hands off.** After each step, Jev checks whether the request is done. If it is, Jev closes the turn. If not, it takes the next step, up to `maxSteps` (3). Anything uncertain goes to the LLM, as does anything that needs an answer in words, a failed step, or a repeated step. Once the LLM has spoken in a turn, it keeps that turn. Jev's tool calls carry `jev_`-prefixed ids, so the server stays stateless.
- **It can look.** With [`@sitepilot/computer`](#computer-use-plugin-sitepilotcomputer) installed and allowed, Jev may hit a request that points at something the text list can't settle, like "press the blue button" or "open the project Linus owns". It then takes one frame per turn (an empty `computer` batch) and picks the element from the picture. Project cards and other items in the frame count. This only helps with real pixels: pass `renderElement` (e.g. `html-to-image`'s `toCanvas`), because the default labelled-box frame tells Jev nothing the text list doesn't. The frame goes to TypeSafe, and `look: false` turns this off.
- **It needs `prompt: "server"`.** The element keys Jev chooses from come from the `sitepilot` context. In client mode there is nothing to target, so every round goes to the LLM.
- **Every judgment that acts must clear `threshold`** (0.7): "nothing needs saying", the tool, the target and each argument, and the picked target or `enum` must be one Jev was offered. The one exception is the decision to *look*, which fires on a lower fixed bar (0.5) because a frame only gathers more context, it doesn't act. `onRoute` receives every decision with Jev's raw answers, so you can tune it on your own pages. Any Jev error falls through to the LLM.
- **What reaches TypeSafe.** Turning the router on sends each round to TypeSafe: the user's request, the on-screen element keys and descriptions (including server-side `hints`), `app_facts` from `prompt.extra`, and the recent transcript — plus a screenshot when Jev looks. All of it is for the routing decision; `look: false` withholds only the image. Keep anything you don't want leaving the server out of hints/extra, or leave the router off for those routes.

`router` is a plain `(input) => Promise<{ route: "llm" } | { route: "self", content, toolCalls }>`, so you can plug in your own. A `self` answer goes back to the browser in the usual chat-completions shape.

### History

```ts
history: {
  initial: JSON.parse(localStorage.getItem("pilot") ?? "[]"),   // restore
  onChange: (h) => localStorage.setItem("pilot", JSON.stringify(h)),   // persist every write
  max: 40,                                                       // wire messages per round
  trim: (h, max) => …,                                           // your own windowing / summarisation hook
}
```

`pilot.getHistory()` / `pilot.loadHistory()` do the same imperatively; loading rebuilds the visible transcript from the user/assistant text. Screenshots are never persisted — they're stripped after the turn that produced them.

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

## Static sites (GitHub Pages, Netlify, S3…)

Everything sitepilot does runs in the browser; the only thing a static site can't hold is the LLM key. Put `createPilotHandler` on a Cloudflare Worker (free tier) with `allowOrigins` set to your site — see [`examples/cloudflare-worker`](examples/cloudflare-worker). The site then points at `https://<name>.workers.dev` and stays 100% static.

## Security notes

- The proxy strips everything but `messages`, `tools` and `user`, pins `model`, caps message count and body size, and rejects `image_url` parts that are not `data:image/…` or `https://`. Cross-origin callers are refused unless listed in `allowOrigins` (which also answers preflights). Add your own auth/rate-limit in front of it — it is deliberately unopinionated about sessions.
- The browser builds the system prompt. That is by design (the DOM is there), and it is not a secret; the key is. `systemPrompt` on the server is prepended and cannot be removed by the client.
- Consent is enforced twice: disabled tools are not advertised, and a call to one is refused even if the model invents it.

## Development

```bash
bun install
bun run build
bun run test        # happy-dom; layout is stubbed in test/setup.ts
bun run typecheck
bun run lint        # Biome, as CI runs it; `bun run format` fixes
```

MIT © Ohanael
