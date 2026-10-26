import type { PromptContext } from "./prompt";
import { parseToolArgs, type ContentPart, type ToolCall, type ToolSpec } from "./tools";

export interface WireToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface CompletionRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Stable end-user id for the provider's abuse tracking (OpenAI `user`). */
  userId?: string;
  /**
   * Present only in `prompt: "server"` mode: the structured context the server
   * renders into the system prompt itself. Goes on the wire as `sitepilot`.
   */
  context?: PromptContext;
}

export interface CompletionReply {
  content: string;
  toolCalls: ToolCall[];
  wireToolCalls: WireToolCall[];
  /** The completion's `model`: who answered this round. */
  model?: string;
}

/** The seam between the browser loop and whatever answers it. */
export interface Transport {
  complete(req: CompletionRequest, opts: { signal: AbortSignal }): Promise<CompletionReply>;
}

export interface OpenAITransportOptions {
  /** A chat-completions URL: `/api/pilot`, `https://api.openai.com/v1/chat/completions`, a LiteLLM proxy… */
  url: string;
  model?: string;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  fetch?: typeof fetch;
}

interface CompletionJson {
  model?: unknown;
  choices?: Array<{ message?: { content?: string | null; tool_calls?: WireToolCall[] } }>;
  error?: { message?: string } | string;
}

export function parseCompletion(json: CompletionJson): CompletionReply {
  const message = json.choices?.[0]?.message;
  if (!message) {
    const err = typeof json.error === "string" ? json.error : json.error?.message;
    throw new Error(err ?? "Empty completion: no choices returned");
  }
  const wireToolCalls = (message.tool_calls ?? []).filter((c) => c?.id && c.function?.name);
  return {
    content: message.content ?? "",
    ...(typeof json.model === "string" && json.model && { model: json.model }),
    wireToolCalls,
    toolCalls: wireToolCalls.map((c) => ({
      id: c.id,
      name: c.function.name,
      args: parseToolArgs(c.function.arguments),
    })),
  };
}

export function openaiTransport(options: OpenAITransportOptions): Transport {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    async complete(req, { signal }) {
      const extra = typeof options.headers === "function" ? await options.headers() : (options.headers ?? {});
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", ...extra },
        body: JSON.stringify({
          ...(options.model && { model: options.model }),
          messages: req.messages,
          ...(req.tools?.length && { tools: req.tools }),
          ...(req.userId && { user: req.userId }),
          ...(req.context && { sitepilot: req.context }),
        }),
        signal,
      });
      const text = await res.text();
      let json: CompletionJson;
      try {
        json = JSON.parse(text) as CompletionJson;
      } catch {
        throw new Error(`Completion endpoint returned ${res.status}: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        const err = typeof json.error === "string" ? json.error : json.error?.message;
        throw new Error(err ?? `Completion endpoint returned ${res.status}`);
      }
      return parseCompletion(json);
    },
  };
}
