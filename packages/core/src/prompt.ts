import type { AreaContext, ScreenElement } from "./dom";
import type { UserEvent } from "./events";

export interface ScreenContext {
  path: string;
  ambient: ScreenElement[];
  events: UserEvent[];
  area: AreaContext | null;
}

/**
 * Everything the browser knows for one round, in one bag. Rendered into the
 * system prompt by `buildSystemPrompt` — on the client (default) or on the
 * server when the pilot runs in `prompt: "server"` mode.
 */
export interface PromptContext {
  screen: ScreenContext;
  user: Record<string, unknown> | null;
  /** Free-form app facts for this turn ("Plan: pro. Unread notifications: 3."). */
  extra: string | null;
  /** Plugin operating briefs (e.g. the computer plugin's). */
  briefs: string[];
  enabledTools: string[];
}

export interface PromptOptions {
  /** Base instructions. Default `DEFAULT_SYSTEM_PROMPT`. */
  system?: string | undefined;
  renderScreen?: ((screen: ScreenContext) => string) | undefined;
  renderUser?: ((user: Record<string, unknown>) => string) | undefined;
  /** Default 40. */
  maxEmbeddedElements?: number | undefined;
  /** Include plugin briefs. Default true. */
  briefs?: boolean | undefined;
}

export const DEFAULT_SYSTEM_PROMPT = `You are an in-app assistant embedded in this website. You can see a list of the interactive elements currently on the user's screen and, when tools are available, you can point at them, click them and type into them on the user's behalf.

Rules:
- Target elements ONLY by the exact keys listed under CURRENT SCREEN or returned by get_screen_elements. Never invent a key.
- Prefer highlight_element when the user asks where something is or how to do something — show, don't do.
- Use click_element and fill_field only when the user clearly asked you to act. Never click a final submit, confirm, pay or delete button; leave the last step to the user.
- After a highlight, stop and let the user act. If they click it you will receive "I clicked …" as their next message.
- If the element you need is not on screen, say so and explain where the user can find it instead of guessing.
- Keep replies short and conversational.`;

const DEFAULT_MAX_EMBEDDED = 40;

export function renderScreen(ctx: ScreenContext, maxElements: number = DEFAULT_MAX_EMBEDDED): string {
  const lines = ctx.ambient.slice(0, maxElements).map((e) => `- ${e.key}: ${e.description}`);
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

export function renderUser(user: Record<string, unknown>): string {
  const lines = Object.entries(user)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `- ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  return lines.length ? `ABOUT THE USER:\n${lines.join("\n")}` : "";
}

export function buildSystemPrompt(ctx: PromptContext, opts: PromptOptions = {}): string {
  const screen = (opts.renderScreen ?? ((s) => renderScreen(s, opts.maxEmbeddedElements)))(ctx.screen);
  const user = ctx.user ? (opts.renderUser ?? renderUser)(ctx.user) : "";
  return [
    opts.system ?? DEFAULT_SYSTEM_PROMPT,
    ...(opts.briefs === false ? [] : ctx.briefs),
    screen,
    user,
    ctx.extra ?? "",
  ]
    .filter((s) => s && s.trim())
    .join("\n\n");
}
