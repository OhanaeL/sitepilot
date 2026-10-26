import type { ScanOptions } from "./dom";
import type { Hints, ScreenContext } from "./prompt";
import type { PilotStrings } from "./strings";

/** OpenAI-compatible function tool definition. */
export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export interface ToolOutput {
  content: string;
  /** Media the model must see this round. Turn-scoped: stripped from history on the next user message. */
  attachments?: ContentPart[];
}

/** Whatever you know about the person using the page. `id` is also sent as the OpenAI `user` field. */
export interface PilotUser {
  id?: string;
  name?: string;
  [key: string]: unknown;
}

export interface ToolContext {
  screen(): ScreenContext;
  scan: ScanOptions | undefined;
  enabledTools: readonly string[];
  user: PilotUser | null;
  strings: PilotStrings;
  hints: Hints | undefined;
  /** Post a line to the chat transcript ("Clicked Save button"). */
  activity(text: string): void;
  /** Send a follow-up user turn once the current one finishes. */
  enqueueUserTurn(text: string): void;
  setHighlight(key: string | null): void;
  /** Aborts when the user stops the run: check it before acting on the page. */
  signal: AbortSignal;
}

export interface PilotTool {
  spec: ToolSpec;
  /** Actions need user consent (`enabledTools`); utilities ride along whenever any action is enabled. */
  kind: "action" | "utility";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput | string>;
}

export interface PilotPlugin {
  name: string;
  tools?: PilotTool[];
  /** Operating instructions appended to the system prompt while the plugin is installed. */
  brief?: string;
}

export interface DefineToolOptions<A extends Record<string, unknown> = Record<string, unknown>> {
  name: string;
  description: string;
  /** JSON Schema for the arguments. Default: an object with no properties. */
  parameters?: Record<string, unknown>;
  /** Default "action" (consent-gated). */
  kind?: "action" | "utility";
  execute(args: A, ctx: ToolContext): Promise<ToolOutput | string> | ToolOutput | string;
}

/** Flat helper for custom tools: `defineTool({ name, description, parameters, execute })`. */
export function defineTool<A extends Record<string, unknown> = Record<string, unknown>>(
  options: DefineToolOptions<A>,
): PilotTool {
  return {
    kind: options.kind ?? "action",
    spec: {
      type: "function",
      function: {
        name: options.name,
        description: options.description,
        parameters: options.parameters ?? { type: "object", properties: {} },
      },
    },
    execute: async (args, ctx) => options.execute(args as A, ctx),
  };
}

/** Patch a tool's advertised description/parameters without touching its behaviour. */
export function patchTool(
  tool: PilotTool,
  patch: Partial<ToolSpec["function"]> & { kind?: PilotTool["kind"] },
): PilotTool {
  const { kind, ...fn } = patch;
  return { ...tool, kind: kind ?? tool.kind, spec: { type: "function", function: { ...tool.spec.function, ...fn } } };
}

export function buildToolSpecs(tools: readonly PilotTool[], enabled: readonly string[]): ToolSpec[] {
  const actions = tools.filter((t) => t.kind === "action" && enabled.includes(t.spec.function.name));
  if (actions.length === 0) return [];
  return [...actions, ...tools.filter((t) => t.kind === "utility")].map((t) => t.spec);
}

export function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
