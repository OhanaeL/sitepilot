import { click, fill, highlight } from "./actions";
import { scanItems, type ScreenElement } from "./dom";
import type { PilotTool } from "./tools";

export type ActionToolName = "highlight_element" | "click_element" | "fill_field";

export const ACTION_TOOLS: readonly ActionToolName[] = ["highlight_element", "click_element", "fill_field"];

const STEP_SETTLE_MS = 350;
const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TARGET = {
  type: "string",
  description: "Key of the on-screen element, exactly as listed under CURRENT SCREEN or returned by get_screen_elements.",
};

const listOf = (found: ScreenElement[]): string =>
  found.length
    ? found.map((e) => `- ${e.key}: ${e.description}`).join("\n")
    : "(no item elements are on screen right now)";

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
    const result = await highlight(key, {
      description: message,
      onAdvance: () => {
        ctx.setHighlight(null);
        ctx.activity(`Clicked ${key}`);
        ctx.enqueueUserTurn(`I clicked "${key}".`);
      },
      onCancel: () => {
        ctx.setHighlight(null);
        ctx.activity(`Dismissed ${key}`);
      },
    });
    if (!result.ok) {
      return `That didn't work — couldn't highlight "${key}": ${result.reason} Pick a different element, or call get_screen_elements to look again.`;
    }
    ctx.setHighlight(key);
    ctx.activity(`Highlighted ${key}`);
    return `Done: highlighted "${key}" for the user. They act on it themselves — if they click it you'll receive "I clicked …" as their next message. Treat this step as delivered and finish your reply.`;
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
    const result = await click(key);
    ctx.activity(result.ok ? `Clicked ${key}` : `Couldn't click ${key}`);
    await settle(STEP_SETTLE_MS);
    return result.ok
      ? `Done: clicked "${key}" on the user's behalf.`
      : `That didn't work — couldn't click "${key}": ${result.reason}`;
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
    const result = await fill(key, text);
    ctx.activity(result.ok ? `Entered "${text}" in ${key}` : `Couldn't fill ${key}`);
    await settle(STEP_SETTLE_MS);
    return result.ok
      ? `Done: filled "${key}" with "${text}" on the user's behalf.`
      : `That didn't work — couldn't fill "${key}": ${result.reason}`;
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
    ctx.activity("Looked at the items on screen");
    return listOf(scanItems(ctx.scan));
  },
};

export const BUILTIN_TOOLS: readonly PilotTool[] = [highlightTool, clickTool, fillTool, lookCloserTool];
