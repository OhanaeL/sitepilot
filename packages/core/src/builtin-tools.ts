import { click, fill, highlight } from "./actions";
import { scanItems } from "./dom";
import { renderElement, type Hints } from "./prompt";
import type { ScreenElement } from "./screen";
import { patchTool, type PilotTool, type ToolSpec } from "./tools";

export type ActionToolName = "highlight_element" | "click_element" | "fill_field";
export type BuiltinToolName = ActionToolName | "get_screen_elements";

export const ACTION_TOOLS: readonly ActionToolName[] = ["highlight_element", "click_element", "fill_field"];

const STEP_SETTLE_MS = 350;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TARGET = {
  type: "string",
  description:
    "Key of the on-screen element, exactly as listed under CURRENT SCREEN or returned by get_screen_elements.",
};

const listOf = (found: ScreenElement[], empty: string, hints?: Hints): string =>
  found.length ? found.map((e) => renderElement(e, hints)).join("\n") : empty;

export const highlightTool: PilotTool = {
  kind: "action",
  spec: {
    type: "function",
    function: {
      name: "highlight_element",
      description:
        "Spotlight one UI element on the user's screen to SHOW them where it is. Display-only — changes nothing. Use for any 'where is X / show me X' request.",
      parameters: {
        type: "object",
        properties: {
          target: TARGET,
          message: { type: "string", description: "Short caption shown next to the highlight." },
        },
        required: ["target"],
      },
    },
  },
  async execute(args, ctx) {
    const key = String(args["target"] ?? "");
    const message = typeof args["message"] === "string" ? args["message"] : key;
    const { strings } = ctx;
    const result = await highlight(key, {
      root: ctx.scan?.root,
      signal: ctx.signal,
      description: message,
      onAdvance: () => {
        ctx.setHighlight(null);
        ctx.activity(strings.activity.clicked(key));
        ctx.enqueueUserTurn(strings.userClicked(key));
      },
      onCancel: () => {
        ctx.setHighlight(null);
        ctx.activity(strings.activity.dismissed(key));
      },
    });
    if (ctx.signal.aborted) return strings.stopped;
    if (!result.ok) return strings.highlightFailed(key, result.reason ?? "");
    ctx.setHighlight(key);
    ctx.activity(strings.activity.highlighted(key));
    return strings.highlighted(key);
  },
};

export const clickTool: PilotTool = {
  kind: "action",
  spec: {
    type: "function",
    function: {
      name: "click_element",
      description:
        "Click a button or link on the user's behalf (open a dialog, switch a tab). Never use it on a final submit/confirm/delete button.",
      parameters: { type: "object", properties: { target: TARGET }, required: ["target"] },
    },
  },
  async execute(args, ctx) {
    const key = String(args["target"] ?? "");
    const { strings } = ctx;
    const result = await click(key, { root: ctx.scan?.root, signal: ctx.signal });
    if (ctx.signal.aborted) return strings.stopped;
    ctx.activity(result.ok ? strings.activity.clicked(key) : strings.activity.clickFailed(key));
    await settle(STEP_SETTLE_MS);
    return result.ok ? strings.clicked(key) : strings.clickFailed(key, result.reason ?? "");
  },
};

export const fillTool: PilotTool = {
  kind: "action",
  spec: {
    type: "function",
    function: {
      name: "fill_field",
      description: "Type text into an input or textarea on the user's behalf.",
      parameters: {
        type: "object",
        properties: {
          target: TARGET,
          text: { type: "string", description: "The text to enter into the field." },
        },
        required: ["target", "text"],
      },
    },
  },
  async execute(args, ctx) {
    const key = String(args["target"] ?? "");
    const text = typeof args["text"] === "string" ? args["text"] : "";
    const { strings } = ctx;
    const result = await fill(key, text, { root: ctx.scan?.root, signal: ctx.signal });
    if (ctx.signal.aborted) return strings.stopped;
    ctx.activity(result.ok ? strings.activity.filled(key, text) : strings.activity.fillFailed(key));
    await settle(STEP_SETTLE_MS);
    return result.ok ? strings.filled(key, text) : strings.fillFailed(key, result.reason ?? "");
  },
};

export const lookCloserTool: PilotTool = {
  kind: "utility",
  spec: {
    type: "function",
    function: {
      name: "get_screen_elements",
      description:
        "Look closer at the user's screen: returns the entity elements (cards, rows) currently visible — e.g. a specific project or person. Call before acting on an item that isn't in the CURRENT SCREEN list.",
      parameters: { type: "object", properties: {} },
    },
  },
  async execute(_args, ctx) {
    ctx.activity(ctx.strings.activity.lookedAtItems);
    return listOf(scanItems(ctx.scan), ctx.strings.noItems, ctx.hints);
  },
};

export const BUILTIN_TOOLS: readonly PilotTool[] = [highlightTool, clickTool, fillTool, lookCloserTool];

export type BuiltinToolsOption =
  | boolean
  | Partial<Record<BuiltinToolName, boolean | (Partial<ToolSpec["function"]> & { kind?: PilotTool["kind"] })>>;

/** Resolve the `builtinTools` option: `false` drops them all; a map disables (`false`) or patches individual ones. */
export function resolveBuiltinTools(option: BuiltinToolsOption = true): PilotTool[] {
  if (option === false) return [];
  if (option === true) return [...BUILTIN_TOOLS];
  return BUILTIN_TOOLS.flatMap((tool) => {
    const entry = option[tool.spec.function.name as BuiltinToolName];
    if (entry === false) return [];
    if (entry === undefined || entry === true) return [tool];
    return [patchTool(tool, entry)];
  });
}
