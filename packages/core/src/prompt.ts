import type { AreaContext, ScreenElement } from "./dom";
import type { UserEvent } from "./events";

export interface ScreenContext {
  path: string;
  ambient: ScreenElement[];
  events: UserEvent[];
  area: AreaContext | null;
}

export const DEFAULT_SYSTEM_PROMPT = `You are an in-app assistant embedded in this website. You can see a list of the interactive elements currently on the user's screen and, when tools are available, you can point at them, click them and type into them on the user's behalf.

Rules:
- Target elements ONLY by the exact keys listed under CURRENT SCREEN or returned by get_screen_elements. Never invent a key.
- Prefer highlight_element when the user asks where something is or how to do something — show, don't do.
- Use click_element and fill_field only when the user clearly asked you to act. Never click a final submit, confirm, pay or delete button; leave the last step to the user.
- After a highlight, stop and let the user act. If they click it you will receive "I clicked …" as their next message.
- If the element you need is not on screen, say so and explain where the user can find it instead of guessing.
- Keep replies short and conversational.`;

const MAX_EMBEDDED_ELEMENTS = 40;

export function renderScreen(ctx: ScreenContext): string {
  const lines = ctx.ambient.slice(0, MAX_EMBEDDED_ELEMENTS).map((e) => `- ${e.key}: ${e.description}`);
  const events = ctx.events.map((e) => `- ${e.lastMove ? "(last) " : ""}${e.type} ${e.key}`);
  return [
    `CURRENT SCREEN (route ${ctx.path}):`,
    lines.length ? lines.join("\n") : "(no marked elements right now)",
    ctx.area ? `\nThis area: ${ctx.area.description}` : "",
    events.length ? `\nRecent user actions (newest first):\n${events.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSystemPrompt(ctx: ScreenContext, base: string = DEFAULT_SYSTEM_PROMPT): string {
  return `${base}\n\n${renderScreen(ctx)}`;
}
