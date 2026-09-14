import { clearHighlight } from "./actions";
import { ACTION_TOOLS, BUILTIN_TOOLS, type ActionToolName } from "./builtin-tools";
import { scanAmbient, scanContext, type ScanOptions } from "./dom";
import { getEvents, installEventsBuffer } from "./events";
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT, type ScreenContext } from "./prompt";
import { buildToolSpecs, type ContentPart, type PilotPlugin, type PilotTool, type ToolCall, type ToolContext } from "./tools";
import type { ChatMessage, Transport } from "./transport";

export interface PilotOptions {
  transport: Transport;
  /**
   * Which action tools the agent may use — the user's consent list. Default: the
   * three built-ins plus every plugin action. Pass `["highlight_element"]` for a
   * point-only guide.
   */
  tools?: readonly string[];
  plugins?: readonly PilotPlugin[];
  systemPrompt?: string;
  getPath?: () => string;
  /** Max model round-trips per user message. Default 8. */
  maxRounds?: number;
  /** Max wire messages kept as conversation memory. Default 40. */
  maxHistory?: number;
  scan?: ScanOptions;
}

export interface PilotMessage {
  id: string;
  role: "user" | "assistant" | "activity";
  content: string;
}

export interface PilotState {
  messages: PilotMessage[];
  status: "idle" | "thinking" | "acting";
  enabledTools: readonly string[];
  activeHighlight: { key: string } | null;
  error: string | null;
}

export interface Pilot {
  send(text: string): Promise<void>;
  stop(): void;
  reset(): void;
  setTools(tools: readonly string[]): void;
  clearHighlight(): void;
  getState(): PilotState;
  subscribe(listener: () => void): () => void;
  /** Every tool installed (built-in + plugins), for consent UIs. */
  availableTools(): readonly PilotTool[];
  collectScreen(): ScreenContext;
}

export type { ActionToolName };
export { ACTION_TOOLS };

type HistoryEntry = ChatMessage & { ephemeral?: boolean };

let counter = 0;
const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${++counter}`;

function trimHistory(history: ChatMessage[], max: number): ChatMessage[] {
  let out = history.slice(-max);
  // Never start on a dangling tool result — cut at a user turn.
  const firstUser = out.findIndex((m) => m.role === "user");
  if (firstUser > 0) out = out.slice(firstUser);
  return out;
}

// Images are for the round that produced them; re-sending every past screenshot
// on every later turn would grow each request by the whole conversation.
function stripEphemeralMedia(history: HistoryEntry[]): HistoryEntry[] {
  return history.map((m) => {
    if (!m.ephemeral || m.role !== "user" || typeof m.content === "string") return m;
    const text = m.content
      .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return { role: "user", content: `${text}\n[screenshot omitted — it was only valid for that turn]` };
  });
}

export function createPilot(options: PilotOptions): Pilot {
  const maxRounds = options.maxRounds ?? 8;
  const maxHistory = options.maxHistory ?? 40;
  const getPath = options.getPath ?? (() => (typeof location !== "undefined" ? location.pathname : "/"));
  const plugins = options.plugins ?? [];
  const tools: readonly PilotTool[] = [...BUILTIN_TOOLS, ...plugins.flatMap((p) => p.tools ?? [])];
  const basePrompt = [options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT, ...plugins.map((p) => p.brief).filter(Boolean)].join(
    "\n\n",
  );

  let state: PilotState = {
    messages: [],
    status: "idle",
    enabledTools: options.tools ?? tools.filter((t) => t.kind === "action").map((t) => t.spec.function.name),
    activeHighlight: null,
    error: null,
  };
  let history: HistoryEntry[] = [];
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let queued: string | null = null;

  installEventsBuffer();

  const set = (patch: Partial<PilotState>): void => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  const push = (role: PilotMessage["role"], content: string): void =>
    set({ messages: [...state.messages, { id: newId(), role, content }] });

  const collectScreen = (): ScreenContext => ({
    path: getPath(),
    ambient: scanAmbient(options.scan),
    events: getEvents(),
    area: scanContext(options.scan?.root),
  });

  const toolContext: ToolContext = {
    screen: collectScreen,
    scan: options.scan,
    get enabledTools() {
      return state.enabledTools;
    },
    activity: (text) => push("activity", text),
    enqueueUserTurn: (text) => {
      if (state.status === "idle") void send(text);
      else queued = text;
    },
    setHighlight: (key) => set({ activeHighlight: key ? { key } : null }),
  };

  async function executeTool(call: ToolCall): Promise<{ content: string; attachments: ContentPart[] }> {
    const tool = tools.find((t) => t.spec.function.name === call.name);
    if (!tool) return { content: `Unknown tool "${call.name}".`, attachments: [] };
    if (tool.kind === "utility" && state.enabledTools.length === 0) {
      return {
        content: "The user has switched off every UI action, so the screen cannot be read. Answer from the conversation instead.",
        attachments: [],
      };
    }
    if (tool.kind === "action" && !state.enabledTools.includes(call.name)) {
      return {
        content: `The "${call.name}" tool is not enabled by the user. Use only the tools offered this turn, or tell the user what to do themselves.`,
        attachments: [],
      };
    }
    try {
      const out = await tool.execute(call.args, toolContext);
      return typeof out === "string" ? { content: out, attachments: [] } : { content: out.content, attachments: out.attachments ?? [] };
    } catch (err) {
      return { content: `Tool "${call.name}" failed: ${err instanceof Error ? err.message : String(err)}`, attachments: [] };
    }
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (state.status !== "idle") {
      queued = trimmed;
      return;
    }

    abort = new AbortController();
    const { signal } = abort;
    push("user", trimmed);
    history = stripEphemeralMedia(history);
    history.push({ role: "user", content: trimmed });
    set({ status: "thinking", error: null });

    try {
      let round = 0;
      for (; round < maxRounds; round++) {
        const system: ChatMessage = { role: "system", content: buildSystemPrompt(collectScreen(), basePrompt) };
        const reply = await options.transport.complete(
          { messages: [system, ...trimHistory(history, maxHistory)], tools: buildToolSpecs(tools, state.enabledTools) },
          { signal },
        );
        if (signal.aborted) return;

        history.push({
          role: "assistant",
          content: reply.content || null,
          ...(reply.wireToolCalls.length && { tool_calls: reply.wireToolCalls }),
        });
        if (reply.content) push("assistant", reply.content);
        if (reply.toolCalls.length === 0) break;

        set({ status: "acting" });
        const attachments: ContentPart[] = [];
        for (const call of reply.toolCalls) {
          const out = await executeTool(call);
          history.push({ role: "tool", tool_call_id: call.id, content: out.content });
          attachments.push(...out.attachments);
          if (signal.aborted) return;
        }
        if (attachments.length) {
          history.push({
            role: "user",
            content: [{ type: "text", text: "Attached: media produced by the tool calls above." }, ...attachments],
            ephemeral: true,
          });
        }
        set({ status: "thinking" });
      }
      if (round === maxRounds) push("activity", `Stopped after ${maxRounds} steps`);
    } catch (err) {
      if (!signal.aborted) set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      abort = null;
      set({ status: "idle" });
      const next = queued;
      queued = null;
      if (next) void send(next);
    }
  }

  return {
    send,
    stop: () => {
      abort?.abort();
      abort = null;
      queued = null;
      set({ status: "idle" });
    },
    reset: () => {
      abort?.abort();
      abort = null;
      queued = null;
      history = [];
      clearHighlight();
      set({ messages: [], status: "idle", activeHighlight: null, error: null });
    },
    setTools: (enabled) => set({ enabledTools: enabled }),
    clearHighlight: () => {
      clearHighlight();
      set({ activeHighlight: null });
    },
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    availableTools: () => tools,
    collectScreen,
  };
}
