export interface PilotHandlerOptions {
  apiKey: string;
  /** Chat-completions API root. Default `https://api.openai.com/v1`. Works with any OpenAI-compatible server (LiteLLM, OpenRouter, Ollama…). */
  baseURL?: string;
  model: string;
  /** Prepended as an extra system message the browser cannot remove. */
  systemPrompt?: string;
  temperature?: number;
  /** Default 60. */
  maxMessages?: number;
  /** Default 8 MiB — screenshots from @sitepilot/computer ride inline as data URLs. */
  maxBodyBytes?: number;
  /** Extra fields merged into the upstream request (e.g. `reasoning_effort`). */
  extraBody?: Record<string, unknown>;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;

const ROLES = new Set(["system", "user", "assistant", "tool"]);

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const error = (status: number, message: string): Response => json(status, { error: { message } });

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

function cleanTool(raw: unknown): Json | null {
  const t = raw as Json;
  const fn = t?.["function"] as Json | undefined;
  if (t?.["type"] !== "function" || typeof fn?.["name"] !== "string") return null;
  const cleaned: Json = { name: fn["name"] };
  if (typeof fn["description"] === "string") cleaned["description"] = fn["description"];
  if (fn["parameters"] && typeof fn["parameters"] === "object") cleaned["parameters"] = fn["parameters"];
  return { type: "function", function: cleaned };
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

  return async (req) => {
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
    const tools = Array.isArray(body["tools"]) ? body["tools"].map(cleanTool).filter(Boolean) : [];

    const upstream = await doFetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({
        model: options.model,
        ...(options.temperature !== undefined && { temperature: options.temperature }),
        ...options.extraBody,
        messages: options.systemPrompt ? [{ role: "system", content: options.systemPrompt }, ...messages] : messages,
        ...(tools.length && { tools }),
        stream: false,
      }),
      signal: req.signal,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
    });
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
    const response = await handler(
      new Request(`http://localhost${req.url ?? "/"}`, { method: req.method ?? "POST", headers, ...(body && { body }) }),
    );
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  };
}
