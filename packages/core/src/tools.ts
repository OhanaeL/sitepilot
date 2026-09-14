import type { ScanOptions } from "./dom";
import type { ScreenContext } from "./prompt";

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

export interface ToolContext {
  screen(): ScreenContext;
  scan: ScanOptions | undefined;
  enabledTools: readonly string[];
  /** Post a line to the chat transcript ("Clicked Save button"). */
  activity(text: string): void;
  /** Send a follow-up user turn once the current one finishes. */
  enqueueUserTurn(text: string): void;
  setHighlight(key: string | null): void;
}

export interface PilotTool {
  spec: ToolSpec;
  /** Actions need user consent (the `tools` list); utilities ride along whenever any action is enabled. */
  kind: "action" | "utility";
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput | string>;
}

export interface PilotPlugin {
  name: string;
  tools?: PilotTool[];
  /** Operating instructions appended to the system prompt while the plugin is installed. */
  brief?: string;
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
