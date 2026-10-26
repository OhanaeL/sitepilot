import { clearHighlight } from "./actions";
import { ACTION_TOOLS, resolveBuiltinTools, type ActionToolName, type BuiltinToolsOption } from "./builtin-tools";
import { scanAmbient, scanContext, type ScanOptions } from "./dom";
import { showSeen } from "./seen";
import { getEvents, installEventsBuffer } from "./events";
import { buildSystemPrompt, DEFAULT_MAX_EMBEDDED, type Hints, type PromptContext, type PromptOptions, type ScreenContext } from "./prompt";
import { getManifest, loadManifest, setManifest, type PilotManifest } from "./manifest";
import { mergeStrings, type PilotStrings, type PilotStringsOverride } from "./strings";
import {
  buildToolSpecs,
  type ContentPart,
  type PilotPlugin,
  type PilotTool,
  type PilotUser,
  type ToolCall,
  type ToolContext,
} from "./tools";
import type { ChatMessage, CompletionRequest, Transport } from "./transport";

type Getter<T> = T | (() => T);

export interface HistoryOptions {
  /** Wire messages to start from (e.g. restored from storage). */
  initial?: ChatMessage[];
  /** Called after every change with the full wire history — persist it wherever you like. */
  onChange?: (history: ChatMessage[]) => void;
  /** Max wire messages sent per round. Default 40. */
  max?: number;
  /** Replace the default trimmer (last `max`, cut at a user turn). */
  trim?: (history: ChatMessage[], max: number) => ChatMessage[];
}

export interface PilotOptions {
  transport: Transport;
  /** Runtime consent list of action tool names. Default: every action installed (built-in, custom, plugin). */
  enabledTools?: readonly string[];
  /** Custom tools, first-class. See `defineTool`. A getter is read every round, so closures may track live state. */
  tools?: Getter<readonly PilotTool[] | undefined>;
  /** Keep, drop, or patch the built-ins. Default `true`. */
  builtinTools?: BuiltinToolsOption;
  plugins?: readonly PilotPlugin[];
  /**
   * Where the system prompt is composed. `"client"` (default) builds it in the
   * browser; `"server"` sends only the structured context (`sitepilot` field) and
   * lets `@sitepilot/server` (or your own endpoint) render it, so your wording
   * never ships to the client.
   */
  prompt?: "client" | "server";
  /** Base instructions (client mode). Default `DEFAULT_SYSTEM_PROMPT`. */
  systemPrompt?: string;
  /** Custom renderers and limits for the prompt (client mode). */
  promptOptions?: Omit<PromptOptions, "system" | "hints">;
  /** Hidden per-element guidance by label, merged with `data-pilot-hint`. In server mode, set `prompt.hints` on the server instead. */
  hints?: Hints;
  /** Site-wide config: selectors → labels/hints/areas, plus `hints` and `systemPrompt`. An object or a URL to fetch. */
  manifest?: PilotManifest | string;
  /** Who is using the page. Rendered into the prompt; `id` also rides as the OpenAI `user` field. */
  user?: Getter<PilotUser | null | undefined>;
  /** Per-turn app facts to add to the prompt, e.g. `() => \`Plan: ${plan}. Cart items: ${n}.\``. */
  context?: Getter<string | null | undefined>;
  /** Override any model-facing result string or transcript line. */
  strings?: PilotStringsOverride;
  history?: HistoryOptions;
  getPath?: () => string;
  /** Max model round-trips per user message. Default 8. */
  maxRounds?: number;
  scan?: ScanOptions;
}

export interface PilotMessage {
  id: string;
  role: "user" | "assistant" | "activity";
  content: string;
  /** The model whose round produced it (the completion's `model`), when the transport reported one. */
  by?: string;
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
  /** Resolves once a URL manifest has loaded (immediately otherwise). `send` waits on it. */
  ready: Promise<void>;
  /** Every tool installed (built-in + custom + plugins), for consent UIs. */
  availableTools(): readonly PilotTool[];
  /** The wire history (what the model sees), for persistence. */
  getHistory(): ChatMessage[];
  /** Replace the wire history and rebuild the transcript from its user/assistant text. */
  loadHistory(history: ChatMessage[]): void;
  collectScreen(): ScreenContext;
  /** Outline what the model is sent, using this pilot's scan options and tool consent. Returns the remover. */
  showSeen(): () => void;
  strings: PilotStrings;
}

export type { ActionToolName };
export { ACTION_TOOLS };

type HistoryEntry = ChatMessage & { ephemeral?: boolean };

let counter = 0;
const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `m${++counter}`;

const resolve = <T>(v: Getter<T>): T => (typeof v === "function" ? (v as () => T)() : v);

export function defaultTrim(history: ChatMessage[], max: number): ChatMessage[] {
  let out = history.slice(-max);
  // Never start on a dangling tool result — cut at a user turn.
  const firstUser = out.findIndex((m) => m.role === "user");
  if (firstUser > 0) out = out.slice(firstUser);
  return out;
}

// Images are for the round that produced them; re-sending every past screenshot
// on every later turn would grow each request by the whole conversation.
function stripEphemeralMedia(history: HistoryEntry[], omitted: string): HistoryEntry[] {
  return history.map((m) => {
    if (!m.ephemeral || m.role !== "user" || typeof m.content === "string") return m;
    const text = m.content
      .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return { role: "user", content: `${text}\n${omitted}` };
  });
}

function transcriptOf(history: ChatMessage[]): PilotMessage[] {
  return history.flatMap((m): PilotMessage[] => {
    if (m.role === "user" && typeof m.content === "string") return [{ id: newId(), role: "user", content: m.content }];
    if (m.role === "assistant" && m.content) return [{ id: newId(), role: "assistant", content: m.content }];
    return [];
  });
}

export function createPilot(options: PilotOptions): Pilot {
  const maxRounds = options.maxRounds ?? 8;
  const maxHistory = options.history?.max ?? 40;
  const trim = options.history?.trim ?? defaultTrim;
  const getPath = options.getPath ?? (() => (typeof location !== "undefined" ? location.pathname : "/"));
  const plugins = options.plugins ?? [];
  const fixedTools: readonly PilotTool[] = [...resolveBuiltinTools(options.builtinTools), ...plugins.flatMap((p) => p.tools ?? [])];
  const tools = (): readonly PilotTool[] => [...fixedTools, ...(resolve(options.tools) ?? [])];
  const briefs = plugins.map((p) => p.brief).filter((b): b is string => !!b);
  const strings = mergeStrings(options.strings);

  let manifestError: string | null = null;
  const ready: Promise<void> = options.manifest
    ? loadManifest(options.manifest).then(setManifest, (err) => {
        manifestError = `manifest: ${err instanceof Error ? err.message : String(err)}`;
        set({ error: manifestError });
      })
    : Promise.resolve();

  const hints = (): Hints | undefined => {
    const fromManifest = getManifest()?.hints;
    const own = options.hints;
    if (!fromManifest) return own;
    if (!own) return fromManifest;
    if (typeof own === "function") return (e) => [fromManifest[e.key], own(e)].filter(Boolean).join(" ") || undefined;
    return { ...fromManifest, ...own };
  };
  const promptOptions = (): PromptOptions => ({
    ...options.promptOptions,
    system: options.systemPrompt ?? getManifest()?.systemPrompt,
    hints: hints(),
  });

  let state: PilotState = {
    messages: [],
    status: "idle",
    enabledTools: options.enabledTools ?? tools().filter((t) => t.kind === "action").map((t) => t.spec.function.name),
    activeHighlight: null,
    error: null,
  };
  let history: HistoryEntry[] = options.history?.initial ? [...options.history.initial] : [];
  if (history.length) state = { ...state, messages: transcriptOf(history) };
  const listeners = new Set<() => void>();
  let abort: AbortController | null = null;
  let queued: string | null = null;

  installEventsBuffer();

  const set = (patch: Partial<PilotState>): void => {
    state = { ...state, ...patch };
    for (const l of listeners) l();
  };
  let toolsBy: string | undefined;
  const push = (role: PilotMessage["role"], content: string, by?: string): void =>
    set({ messages: [...state.messages, { id: newId(), role, content, ...(by && { by }) }] });
  const record = (entry: HistoryEntry): void => {
    history.push(entry);
    options.history?.onChange?.(history.map(({ ephemeral: _, ...m }) => m as ChatMessage));
  };

  const collectScreen = (): ScreenContext => ({
    path: getPath(),
    ambient: scanAmbient(options.scan),
    events: getEvents(),
    area: scanContext(options.scan?.root),
  });

  const promptContext = (): PromptContext => ({
    screen: collectScreen(),
    user: resolve(options.user) ?? null,
    extra: resolve(options.context) ?? null,
    briefs,
    enabledTools: [...state.enabledTools],
  });

  const toolContext: ToolContext = {
    screen: collectScreen,
    scan: options.scan,
    strings,
    get hints() {
      return hints();
    },
    get enabledTools() {
      return state.enabledTools;
    },
    get user() {
      return resolve(options.user) ?? null;
    },
    activity: (text) => push("activity", text, toolsBy),
    enqueueUserTurn: (text) => {
      if (state.status === "idle") void send(text);
      else queued = text;
    },
    setHighlight: (key) => set({ activeHighlight: key ? { key } : null }),
  };

  async function executeTool(call: ToolCall): Promise<{ content: string; attachments: ContentPart[] }> {
    const tool = tools().find((t) => t.spec.function.name === call.name);
    if (!tool) return { content: strings.unknownTool(call.name), attachments: [] };
    if (tool.kind === "utility" && state.enabledTools.length === 0) return { content: strings.screenOff, attachments: [] };
    if (tool.kind === "action" && !state.enabledTools.includes(call.name)) {
      return { content: strings.toolNotEnabled(call.name), attachments: [] };
    }
    try {
      const out = await tool.execute(call.args, toolContext);
      return typeof out === "string" ? { content: out, attachments: [] } : { content: out.content, attachments: out.attachments ?? [] };
    } catch (err) {
      return { content: strings.toolThrew(call.name, err instanceof Error ? err.message : String(err)), attachments: [] };
    }
  }

  function requestFor(): CompletionRequest {
    const ctx = promptContext();
    const serverMode = options.prompt === "server";
    const system: ChatMessage[] = serverMode ? [] : [{ role: "system", content: buildSystemPrompt(ctx, promptOptions()) }];
    const userId = typeof ctx.user?.["id"] === "string" ? ctx.user["id"] : undefined;
    return {
      messages: [...system, ...trim(history, maxHistory)],
      tools: buildToolSpecs(tools(), state.enabledTools),
      ...(userId && { userId }),
      ...(serverMode && { context: ctx }),
    };
  }

  async function runTools(calls: ToolCall[], signal: AbortSignal, by: string | undefined): Promise<void> {
    const attachments: ContentPart[] = [];
    toolsBy = by;
    try {
      for (const call of calls) {
        const out = await executeTool(call);
        record({ role: "tool", tool_call_id: call.id, content: out.content });
        attachments.push(...out.attachments);
        if (signal.aborted) return;
      }
    } finally {
      toolsBy = undefined;
    }
    if (attachments.length) {
      record({ role: "user", content: [{ type: "text", text: strings.attachmentsNote }, ...attachments], ephemeral: true });
    }
  }

  async function loop(signal: AbortSignal): Promise<"done" | "capped"> {
    for (let round = 0; round < maxRounds; round++) {
      const reply = await options.transport.complete(requestFor(), { signal });
      if (signal.aborted) return "done";
      record({
        role: "assistant",
        content: reply.content || null,
        ...(reply.wireToolCalls.length && { tool_calls: reply.wireToolCalls }),
      });
      if (reply.content) push("assistant", reply.content, reply.model);
      if (reply.toolCalls.length === 0) return "done";

      set({ status: "acting" });
      await runTools(reply.toolCalls, signal, reply.model);
      if (signal.aborted) return "done";
      set({ status: "thinking" });
    }
    return "capped";
  }

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (state.status !== "idle") {
      queued = trimmed;
      return;
    }

    await ready;
    const run = new AbortController();
    abort = run;
    push("user", trimmed);
    history = stripEphemeralMedia(history, strings.screenshotOmitted);
    record({ role: "user", content: trimmed });
    set({ status: "thinking", error: manifestError });

    try {
      if ((await loop(run.signal)) === "capped") push("activity", strings.activity.stoppedAfter(maxRounds));
    } catch (err) {
      if (!run.signal.aborted) set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (abort === null || abort === run) {
        abort = null;
        set({ status: "idle" });
        const next = queued;
        queued = null;
        if (next) void send(next);
      }
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
      options.history?.onChange?.([]);
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
    availableTools: tools,
    getHistory: () => history.map(({ ephemeral: _, ...m }) => m as ChatMessage),
    loadHistory: (h) => {
      history = [...h];
      set({ messages: transcriptOf(history) });
    },
    collectScreen,
    showSeen: () =>
      showSeen({
        scan: options.scan,
        items: () => state.enabledTools.length > 0,
        embedded: options.promptOptions?.maxEmbeddedElements ?? DEFAULT_MAX_EMBEDDED,
      }),
    strings,
    ready,
  };
}
