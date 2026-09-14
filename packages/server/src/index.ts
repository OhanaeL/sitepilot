import { buildSystemPrompt, type PromptContext, type PromptOptions } from "@sitepilot/core/prompt";

/**
 * `PromptOptions` plus server-only hooks. `hints` maps element labels to
 * guidance the model reads next to that element — the private counterpart of
 * `data-pilot-hint`, never sent to the browser.
 */
export interface ServerPromptOptions extends PromptOptions {
  /** Server-only additions per request (session facts, feature flags…). Appended after the rendered context. */
  extra?: (ctx: PromptContext, req: Request) => string | null | undefined | Promise<string | null | undefined>;
}

export interface PilotHandlerOptions {
  apiKey: string;
  /** Chat-completions API root. Default `https://api.openai.com/v1`. Works with any OpenAI-compatible server (LiteLLM, OpenRouter, Ollama…). */
  baseURL?: string;
  model: string;
  /** Prepended as an extra system message the browser cannot remove (both modes). */
  systemPrompt?: string;
  /**
   * Server-side prompt composition. When the browser runs `prompt: "server"` it
   * sends a `sitepilot` context instead of a system message; this renders it
   * here so your wording never ships to the client. `system` replaces the
   * default base instructions.
   */
  prompt?: ServerPromptOptions;
  /** Rewrite advertised tool descriptions by name, e.g. `{ click_element: "…" }`. */
  toolDescriptions?: Record<string, string>;
  temperature?: number;
  /** Default 60. */
  maxMessages?: number;
  /** Default 8 MiB — screenshots from @sitepilot/computer ride inline as data URLs. */
  maxBodyBytes?: number;
  /** Extra fields merged into the upstream request (e.g. `reasoning_effort`). */
  extraBody?: Record<string, unknown>;
  /**
   * Browser origins allowed to call this endpoint cross-site (a static site on
   * GitHub Pages talking to a Worker). Exact origins or `*`. Answers preflights,
   * sets the CORS headers, and rejects other origins with 403. Same-origin
   * requests (no `Origin` header, or one matching the request host) always pass.
   */
  allowOrigins?: string[];
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

const ROLES = new Set(["system", "user", "assistant", "tool"]);

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const error = (status: number, message: string): Response => json(status, { error: { message } });

function corsHeaders(origin: string): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function withHeaders(res: Response, headers: Record<string, string>): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(headers)) out.headers.set(k, v);
  return out;
}

/** null = same-origin (no CORS needed); a string = allowed cross-origin; false = rejected. */
function checkOrigin(req: Request, allow: string[] | undefined): string | null | false {
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let host = "";
  try {
    host = new URL(req.url).host;
  } catch {
    host = "";
  }
  if (new URL(origin).host === host) return null;
  if (!allow) return false;
  if (allow.includes("*")) return "*";
  return allow.includes(origin) ? origin : false;
}

function isPart(p: unknown): boolean {
  if (!p || typeof p !== "object") return false;
  const part = p as Json;
  if (part["type"] === "text") return typeof part["text"] === "string";
  if (part["type"] === "image_url") {
    const url = (part["image_url"] as Json | undefined)?.["url"];
    return typeof url === "string" && (url.startsWith("data:image/") || url.startsWith("https://"));
  }
  return false;
}

function cleanMessage(raw: unknown): Json | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Json;
  const role = m["role"];
  if (typeof role !== "string" || !ROLES.has(role)) return null;
  const content = m["content"];
  const out: Json = { role };

  if (typeof content === "string" || content === null) out["content"] = content;
  else if (role === "user" && Array.isArray(content) && content.every(isPart)) out["content"] = content;
  else return null;

  if (role === "tool") {
    if (typeof m["tool_call_id"] !== "string") return null;
    out["tool_call_id"] = m["tool_call_id"];
  }
  if (role === "assistant" && Array.isArray(m["tool_calls"])) {
    const calls = m["tool_calls"].filter((c) => {
      const call = c as Json;
      const fn = call?.["function"] as Json | undefined;
      return typeof call?.["id"] === "string" && typeof fn?.["name"] === "string" && typeof fn?.["arguments"] === "string";
    });
    if (calls.length) {
      out["tool_calls"] = calls.map((c) => {
        const call = c as Json;
        const fn = call["function"] as Json;
        return { id: call["id"], type: "function", function: { name: fn["name"], arguments: fn["arguments"] } };
      });
    }
  }
  return out;
}

function cleanTool(raw: unknown, descriptions: Record<string, string>): Json | null {
  const t = raw as Json;
  const fn = t?.["function"] as Json | undefined;
  if (t?.["type"] !== "function" || typeof fn?.["name"] !== "string") return null;
  const name = fn["name"];
  const cleaned: Json = { name };
  const description = descriptions[name] ?? fn["description"];
  if (typeof description === "string") cleaned["description"] = description;
  if (fn["parameters"] && typeof fn["parameters"] === "object") cleaned["parameters"] = fn["parameters"];
  return { type: "function", function: cleaned };
}

const isStr = (v: unknown): v is string => typeof v === "string";
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

function cleanContext(raw: unknown): PromptContext | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Json;
  const screen = c["screen"] as Json | undefined;
  if (!screen || !isStr(screen["path"])) return null;
  const ambient = (Array.isArray(screen["ambient"]) ? screen["ambient"] : [])
    .filter((e): e is Json => !!e && typeof e === "object" && isStr((e as Json)["key"]))
    .map((e) => ({
      key: e["key"] as string,
      description: isStr(e["description"]) ? e["description"] : (e["key"] as string),
      tier: e["tier"] === "item" ? ("item" as const) : ("ambient" as const),
      ...(isStr(e["hint"]) && { hint: e["hint"].slice(0, 400) }),
    }));
  const events = (Array.isArray(screen["events"]) ? screen["events"] : [])
    .filter((e): e is Json => !!e && typeof e === "object" && isStr((e as Json)["key"]) && isStr((e as Json)["type"]))
    .map((e) => ({
      type: e["type"] as "click" | "open" | "input",
      key: e["key"] as string,
      tier: e["tier"] === "item" ? ("item" as const) : ("ambient" as const),
      at: typeof e["at"] === "number" ? e["at"] : 0,
      lastMove: e["lastMove"] === true,
    }));
  const area = screen["area"] as Json | null | undefined;
  const user = c["user"];
  return {
    screen: {
      path: screen["path"],
      ambient,
      events,
      area: area && isStr(area["topic"]) ? { topic: area["topic"], description: isStr(area["description"]) ? area["description"] : area["topic"] } : null,
    },
    user: user && typeof user === "object" ? (user as Record<string, unknown>) : null,
    extra: isStr(c["extra"]) ? c["extra"] : null,
    briefs: strArray(c["briefs"]),
    enabledTools: strArray(c["enabledTools"]),
  };
}

/**
 * Build a `(Request) => Promise<Response>` handler for `/api/pilot`. Mount it in
 * a Next.js route handler, Hono, Bun.serve, Cloudflare Workers, or wrap it with
 * `toNodeListener` for Express/Node http.
 */
export function createPilotHandler(options: PilotHandlerOptions): (req: Request) => Promise<Response> {
  const baseURL = (options.baseURL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const maxMessages = options.maxMessages ?? 60;
  const maxBodyBytes = options.maxBodyBytes ?? 8 * 1024 * 1024;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const handle = async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return error(405, "POST only");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > maxBodyBytes) return error(413, "request body too large");
    const text = await req.text();
    if (text.length > maxBodyBytes) return error(413, "request body too large");

    let body: Json;
    try {
      body = JSON.parse(text) as Json;
    } catch {
      return error(400, "body must be JSON");
    }
    if (!Array.isArray(body["messages"]) || body["messages"].length === 0) return error(400, "messages required");
    if (body["messages"].length > maxMessages) return error(400, `at most ${maxMessages} messages`);

    const messages = body["messages"].map(cleanMessage);
    if (messages.some((m) => m === null)) return error(400, "malformed message");
    const tools = Array.isArray(body["tools"])
      ? body["tools"].map((t) => cleanTool(t, options.toolDescriptions ?? {})).filter(Boolean)
      : [];

    const system: Json[] = [];
    if (options.systemPrompt) system.push({ role: "system", content: options.systemPrompt });
    const context = cleanContext(body["sitepilot"]);
    if (context) {
      const { extra, ...promptOptions } = options.prompt ?? {};
      const serverExtra = extra ? await extra(context, req) : null;
      const ctx: PromptContext = { ...context, extra: [context.extra, serverExtra].filter(Boolean).join("\n\n") || null };
      system.push({ role: "system", content: buildSystemPrompt(ctx, promptOptions) });
    }
    const user = isStr(body["user"]) ? body["user"].slice(0, 256) : undefined;

    const upstream = await doFetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model: options.model,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...options.extraBody,
        messages: [...system, ...messages],
        ...(tools.length && { tools }),
        ...(user && { user }),
        stream: false,
      }),
      signal: req.signal,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
  };

  return async (req) => {
    const origin = checkOrigin(req, options.allowOrigins);
    if (origin === false) return error(403, "origin not allowed");
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: origin ? corsHeaders(origin) : {} });
    }
    const res = await handle(req);
    return origin ? withHeaders(res, corsHeaders(origin)) : res;
  };
}

interface NodeReq {
  method?: string | undefined;
  url?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data" | "end" | "error", cb: (chunk?: unknown) => void): void;
}

interface NodeRes {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/** Adapt the fetch-standard handler for Node `http` / Express / Fastify raw requests. */
export function toNodeListener(handler: (req: Request) => Promise<Response>) {
  return async (req: NodeReq, res: NodeRes): Promise<void> => {
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      req.on("data", (c) => chunks.push(c as Uint8Array));
      req.on("end", () => resolve());
      req.on("error", (e) => reject(e));
    });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
      else if (Array.isArray(v)) headers.set(k, v.join(", "));
    }
    const body = chunks.length ? new Blob(chunks as BlobPart[]) : undefined;
    const host = headers.get("host") ?? "localhost";
    const response = await handler(
      new Request(`http://${host}${req.url ?? "/"}`, { method: req.method ?? "POST", headers, ...(body && { body }) }),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
}
