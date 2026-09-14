import { beginAgentAction, endAgentAction, type PilotPlugin, type PilotTool, type ToolOutput } from "@sitepilot/core";
import { COORD_MAX, MAX_ACTIONS, parseBatch, REJECTED, SCHEMA, type Action } from "./batch";
import {
  elementAt,
  frameElements,
  schematicRenderer,
  viewport,
  type ElementRenderer,
  type FrameElement,
  type FrameRenderer,
} from "./frame";

export * from "./batch";
export * from "./frame";

export interface ComputerPluginOptions {
  /** Longest edge of the rendered frame, in pixels. Default 1024. */
  maxEdge?: number;
  /** Composite each opted-in element's real pixels (e.g. html-to-image `toCanvas`) instead of a labelled box. */
  renderElement?: ElementRenderer;
  /** Replace the frame renderer entirely. */
  renderFrame?: FrameRenderer;
  root?: ParentNode;
}

export interface Failure {
  index: number;
  do: Action["do"];
  why: string;
}

export interface Outcome {
  screen: { w: number; h: number; space: "norm1000" };
  executed: number;
  requested: number;
  failed: Failure | null;
  screenshot: "attached" | "unavailable";
  elements: Array<{ key: string; x: number; y: number; w: number; h: number }>;
}

export const COMPUTER_BRIEF = `You also have a \`computer\` tool: it runs a short batch of actions on the page and then captures a frame of the screen.

THE FRAME IS NOT THE WHOLE PAGE. It shows only the elements the site owner opted in — each drawn as a labelled box (or its own pixels) on a blank background, at its true position. Anything not in the frame does not exist for you: you cannot see it, click it, or type into it.

LOOK BEFORE YOU ACT. Your first \`computer\` call in a turn should be an observation: an empty \`actions\` list. Read the frame and the \`elements\` list that comes back, then act. A frame from an earlier turn says nothing about the screen now.

Coordinates are normalized 0-999 across the width and 0-999 down the height, (0,0) at the top-left. A click lands on the opted-in element under that point; a click on empty space fails and stops the batch. \`type\` goes into the field you clicked last.

Batch actions — up to ${MAX_ACTIONS} per call, run in order, stopping at the first failure. The reply reports \`executed\` against \`requested\`: trust that count. Nothing pauses on its own; end a batch with a short \`wait\` if the page needs to repaint before the capture.

AFTER ACTING, LOOK AGAIN. Every call captures after its actions ran, so check the returned frame before reporting success.

When an element key is already in CURRENT SCREEN, \`highlight_element\` / \`click_element\` / \`fill_field\` by key are cheaper and more precise than coordinates — prefer them; use \`computer\` when you need to see layout or the user asks what the screen looks like.`;

const settle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function focusedField(root?: ParentNode): HTMLInputElement | HTMLTextAreaElement | null {
  const active = (root instanceof Document ? root : document).activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (!active.closest("[data-pilot], [data-pilot-item]")) return null;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return active;
  return active.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
}

function typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(field, field.value + text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function scrollTarget(hit: FrameElement | null): Element | Window {
  for (let el: HTMLElement | null = hit?.el ?? null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return window;
}

async function run(action: Action, root: ParentNode | undefined): Promise<string | null> {
  const vp = viewport();
  switch (action.do) {
    case "click": {
      const hit = elementAt(action.x, action.y, vp, root);
      if (!hit) return `no opted-in element at (${action.x}, ${action.y}) — only boxes shown in the frame can be clicked`;
      beginAgentAction();
      try {
        hit.el.focus?.();
        hit.el.click();
      } finally {
        endAgentAction();
      }
      return null;
    }
    case "type": {
      const field = focusedField(root);
      if (!field) return "no opted-in text field is focused — click one first";
      beginAgentAction();
      try {
        typeInto(field, action.text);
      } finally {
        endAgentAction();
      }
      return null;
    }
    case "scroll": {
      const hit =
        action.x !== undefined && action.y !== undefined ? elementAt(action.x, action.y, vp, root) : null;
      const target = scrollTarget(hit);
      const dy = action.dy * 100;
      if (target instanceof Window) target.scrollBy({ top: dy });
      else target.scrollBy({ top: dy });
      return null;
    }
    case "wait":
      await settle(action.ms);
      return null;
  }
}

export function computerPlugin(options: ComputerPluginOptions = {}): PilotPlugin {
  const render =
    options.renderFrame ??
    schematicRenderer({
      ...(options.maxEdge !== undefined && { maxEdge: options.maxEdge }),
      ...(options.renderElement && { renderElement: options.renderElement }),
    });

  const tool: PilotTool = {
    kind: "action",
    spec: {
      type: "function",
      function: {
        name: "computer",
        description:
          "Act on the page, then capture a frame showing only the opted-in elements. Actions run in order and stop at the first failure. Coordinates are normalized 0-999 with (0,0) at the top-left. Pass an empty actions list to look without acting. The frame arrives as an image in this turn.",
        parameters: SCHEMA,
      },
    },
    async execute(args, ctx): Promise<ToolOutput> {
      let batch;
      try {
        batch = parseBatch(args);
      } catch (err) {
        return { content: `${REJECTED}\n\nThe parser said: ${err instanceof Error ? err.message : String(err)}` };
      }

      let executed = 0;
      let failed: Failure | null = null;
      for (const [index, action] of batch.actions.entries()) {
        const why = await run(action, options.root);
        if (why) {
          failed = { index, do: action.do, why };
          break;
        }
        executed++;
      }
      ctx.activity(
        batch.actions.length === 0
          ? "Looked at the screen"
          : `Ran ${executed}/${batch.actions.length} actions and looked at the screen`,
      );

      const vp = viewport();
      const elements = frameElements(vp, options.root);
      const image = await render(elements, vp);
      const outcome: Outcome = {
        screen: { w: vp.w, h: vp.h, space: "norm1000" },
        executed,
        requested: batch.actions.length,
        failed,
        screenshot: image ? "attached" : "unavailable",
        elements: elements.map((e) => ({ key: e.key, ...e.rect })),
      };
      return {
        content: JSON.stringify(outcome),
        ...(image && { attachments: [{ type: "image_url", image_url: { url: image, detail: "high" } }] }),
      };
    },
  };

  return { name: "computer", tools: [tool], brief: COMPUTER_BRIEF };
}

export { COORD_MAX };
