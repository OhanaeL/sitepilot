import type { PilotRouter, RouteDecision, RouteInput, RoutedCall } from "./index";

export interface JevRouteEvent {
  route: RouteDecision["route"];
  reason: "done" | "act" | "look" | "needs-llm" | "unsure" | "repeat" | "max-steps" | "llm-turn" | "no-tools" | "error";
  /** Raw Jev answers, when Jev was asked. */
  answers?: Record<string, JevAnswer>;
  error?: unknown;
}

export interface JevRouterOptions {
  /** TypeSafe API key. Keep it server-side. */
  apiKey: string;
  /** Default `https://api.typesafe.ai`. */
  baseURL?: string;
  /** Default `jev-latest`. */
  model?: string;
  /**
   * Tools Jev may call on its own. A tool qualifies only when every required
   * argument is an element `target`, a string `enum`, or a boolean — Jev picks,
   * it never writes text. Default `["highlight_element", "click_element"]`.
   */
  tools?: string[];
  /** The lowest probability any judgment behind a step may have before the LLM takes over. Default 0.7. */
  threshold?: number;
  /** Jev-run steps per user turn before the LLM takes over. Default 3. */
  maxSteps?: number;
  /**
   * When the text list can't pin the target and the `computer` tool is offered,
   * Jev takes one frame per turn and picks from the picture. The frame goes to
   * TypeSafe, so `false` keeps pictures away from it. Default true.
   */
  look?: boolean;
  /** The closing line once Jev's steps succeed. */
  reply?: (calls: RoutedCall[]) => string;
  /** Every decision, with Jev's raw answers — for logs and threshold tuning. */
  onRoute?: (event: JevRouteEvent) => void;
  fetch?: typeof fetch;
}

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

type Json = Record<string, unknown>;

type Arg = { name: string; kind: "target" } | { name: string; kind: "enum"; values: string[]; description?: string } | { name: string; kind: "flag"; description?: string };

interface Candidate {
  name: string;
  description: string;
  args: Arg[];
}

interface Listed {
  key: string;
  description: string;
  hint?: string;
}

interface Action {
  call: RoutedCall;
  result: string;
}

export const JEV_CALL_PREFIX = "jev_";

const DEFAULT_TOOLS = ["highlight_element", "click_element"];
const LOOK_TOOL = "computer";
const LOOK_AT = 0.5;
const MAX_ELEMENTS = 255;
const EARLIER_MESSAGES = 6;

const defaultReply = (calls: RoutedCall[]): string => (calls.at(-1)?.name === "highlight_element" ? "Here it is." : "Done.");

function argOf(name: string, schema: unknown): Arg | null {
  const s = (schema ?? {}) as Json;
  const description = typeof s["description"] === "string" ? s["description"] : undefined;
  if (name === "target" && s["type"] === "string") return { name, kind: "target" };
  if (Array.isArray(s["enum"]) && s["enum"].length && s["enum"].every((v) => typeof v === "string")) {
    return { name, kind: "enum", values: s["enum"] as string[], ...(description && { description }) };
  }
  if (s["type"] === "boolean") return { name, kind: "flag", ...(description && { description }) };
  return null;
}

function candidateOf(tool: Json, allowed: string[], hasElements: boolean): Candidate | null {
  const fn = tool["function"] as Json;
  const name = fn["name"] as string;
  if (!allowed.includes(name)) return null;
  const params = (fn["parameters"] ?? {}) as Json;
  const properties = (params["properties"] ?? {}) as Json;
  const required = Array.isArray(params["required"]) ? (params["required"] as unknown[]).filter((r): r is string => typeof r === "string") : [];
  const args = required.map((r) => argOf(r, properties[r]));
  if (args.some((a) => a === null || (a.kind === "target" && !hasElements))) return null;
  return { name, description: typeof fn["description"] === "string" ? fn["description"] : name, args: args as Arg[] };
}

const isTurnStart = (m: Json): boolean => m["role"] === "user" && typeof m["content"] === "string";

function readTurn(messages: Json[]): { request: string; earlier: Json[]; turn: Json[] } | null {
  const start = messages.map(isTurnStart).lastIndexOf(true);
  if (start < 0) return null;
  return { request: messages[start]!["content"] as string, earlier: messages.slice(0, start), turn: messages.slice(start + 1) };
}

const imagesIn = (m: Json): string[] =>
  Array.isArray(m["content"])
    ? (m["content"] as Json[]).flatMap((p) => (p["type"] === "image_url" ? [String((p["image_url"] as Json)["url"])] : []))
    : [];

function jevTurn(turn: Json[]): { actions: Action[]; frame: string | null } | null {
  const results = new Map(turn.filter((m) => m["role"] === "tool").map((m) => [m["tool_call_id"] as string, String(m["content"] ?? "")]));
  const actions: Action[] = [];
  let frame: string | null = null;
  for (const m of turn) {
    if (m["role"] === "user") frame = imagesIn(m).at(-1) ?? frame;
    if (m["role"] !== "assistant") continue;
    frame = null;
    const calls = Array.isArray(m["tool_calls"]) ? (m["tool_calls"] as Json[]) : [];
    if (!calls.length || calls.some((c) => !String(c["id"]).startsWith(JEV_CALL_PREFIX))) return null;
    for (const c of calls) {
      const fn = c["function"] as Json;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(fn["arguments"] as string) as Record<string, unknown>;
      } catch {
        args = {};
      }
      actions.push({ call: { id: c["id"] as string, name: fn["name"] as string, args }, result: results.get(c["id"] as string) ?? "" });
    }
  }
  return { actions, frame };
}

function frameKeys(result: string): string[] {
  try {
    const elements = (JSON.parse(result) as { elements?: unknown }).elements;
    return Array.isArray(elements) ? elements.flatMap((e) => (typeof (e as Json)?.["key"] === "string" ? [(e as Json)["key"] as string] : [])) : [];
  } catch {
    return [];
  }
}

function assetOf(dataUrl: string): { format: "png" | "jpg"; data_base64: string } | null {
  const match = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl);
  return match ? { format: match[1] === "png" ? "png" : "jpg", data_base64: match[2]! } : null;
}

const transcriptLine = (m: Json): Json[] =>
  (m["role"] === "user" || m["role"] === "assistant") && typeof m["content"] === "string" && m["content"]
    ? [{ speaker: m["role"], text: m["content"] }]
    : [];

const ON_SCREEN: Json = {
  type: "noul",
  instructions:
    "Is `user_request` asking only to show or press one thing on the screen, even one missing from `screen.elements` that the user picks out by its look, its position, or what it shows?",
  criteria: {
    true: "The user points at one thing on screen to be shown or pressed, such as 'press the blue button', 'open the card on the right', 'open the project Linus owns'.",
    false: "The user asks a question that needs words in reply (how, why, what, how many), greets or thanks, wants text typed, or wants several steps done.",
  },
};

function questionsFor(candidates: Candidate[], elements: Record<string, string>, progress: boolean, picture: boolean): Record<string, Json> {
  const rest = progress ? "the part of `user_request` that `actions_taken` has not covered yet" : "`user_request`";
  const questions: Record<string, Json> = {
    self: {
      type: "noul",
      instructions: `Is ${rest} only one of the \`actions\` done to one of the \`screen.elements\`, so that doing it ${progress ? "finishes the request" : "is the whole answer"} and nothing needs to be written back to the user?`,
      criteria: {
        true: "What remains is showing or pressing a listed element, such as 'where is X', 'show me X', 'open X', and that element is in `screen.elements`.",
        false: "What remains needs words in reply (how, why, what, how many), is a greeting or thanks, needs text typed, needs something not in `screen.elements`, or needs several more steps.",
      },
    },
    tool: {
      type: "choice",
      instructions: `Which of the \`actions\` does ${rest} ask for?`,
      criteria: Object.fromEntries(candidates.map((c) => [c.name, c.description])),
    },
  };
  if (progress) {
    questions["done"] = {
      type: "noul",
      instructions: "Has every part of `user_request` been carried out by `actions_taken`, with each result reporting success?",
      criteria: {
        true: "Each `result` reports success, and the actions taken are everything the user asked for. Example: the user said 'open settings' and the Settings link was clicked.",
        false: "A `result` reports a failure, or the user asked for something more than the actions taken, such as a further step or an explanation.",
      },
    };
  }
  if (candidates.some((c) => c.args.some((a) => a.kind === "target"))) {
    const seen = picture ? " `screen.picture` shows the screen, each element drawn where it is and labelled with its key." : "";
    questions["target"] = { type: "choice", instructions: `Which element in \`screen.elements\` is ${rest} about?${seen}`, criteria: elements };
  }
  for (const c of candidates) {
    for (const a of c.args) {
      const about = `For the \`${c.name}\` action, ${a.kind === "enum" ? `which \`${a.name}\` does ${rest} ask for?` : `does ${rest} want \`${a.name}\` on?`}${"description" in a && a.description ? ` (${a.description})` : ""}`;
      if (a.kind === "enum") questions[`${c.name}.${a.name}`] = { type: "choice", instructions: about, criteria: Object.fromEntries(a.values.map((v) => [v, null])) };
      if (a.kind === "flag") questions[`${c.name}.${a.name}`] = { type: "noul", instructions: about };
    }
  }
  return questions;
}

const sure = (a: JevAnswer | undefined): number =>
  !a ? 0 : a.type === "noul" ? Math.max(a.noul, 1 - a.noul) : (a.probabilities[a.choice] ?? 0);

const sameCall = (a: RoutedCall, b: RoutedCall): boolean => a.name === b.name && JSON.stringify(a.args) === JSON.stringify(b.args);

type Reason = JevRouteEvent["reason"];
type Asset = NonNullable<ReturnType<typeof assetOf>>;

interface Query {
  state: Json;
  questions: Record<string, Json>;
  candidates: Candidate[];
  elements: Record<string, string>;
  steps: Action[];
  picture: Asset | null;
  ref: string;
  canLook: boolean;
}

type Outcome = { route: "self"; reason: Reason; content: string | null; toolCalls: RoutedCall[] } | { route: "llm"; reason: Reason };

const newCallId = (): string => `${JEV_CALL_PREFIX}${crypto.randomUUID()}`;

function queryFor({ messages, tools, context }: RouteInput, allowed: string[], maxSteps: number, look: boolean): Query | Reason {
  const turn = readTurn(messages);
  const jev = turn && jevTurn(turn.turn);
  if (!turn || !jev) return "llm-turn";
  const looks = jev.actions.filter((a) => a.call.name === LOOK_TOOL);
  const steps = jev.actions.filter((a) => a.call.name !== LOOK_TOOL);
  if (steps.length >= maxSteps) return "max-steps";

  const lastAction = jev.actions.at(-1);
  const picture = lastAction?.call.name === LOOK_TOOL && jev.frame ? assetOf(jev.frame) : null;
  const ambient = context?.screen.ambient ?? [];
  const inFrame = picture && lastAction ? frameKeys(lastAction.result) : [];
  const listed: Listed[] = [
    ...inFrame.map((key) => ambient.find((e) => e.key === key) ?? { key, description: key }),
    ...ambient.filter((e) => !inFrame.includes(e.key)),
  ].slice(0, MAX_ELEMENTS);

  const candidates = tools.map((t) => candidateOf(t, allowed, listed.length > 0)).filter((c): c is Candidate => c !== null);
  if (!candidates.length) return "no-tools";
  const canLook = look && looks.length === 0 && tools.some((t) => (t["function"] as Json)["name"] === LOOK_TOOL);

  const elements = Object.fromEntries(listed.map((e) => [e.key, e.hint ? `${e.description} — ${e.hint}` : e.description]));
  const progress = steps.length > 0;
  const ref = `${crypto.randomUUID()}-screen`;
  const state: Json = {
    user_request: turn.request,
    ...(turn.earlier.length && { earlier_conversation: turn.earlier.flatMap(transcriptLine).slice(-EARLIER_MESSAGES) }),
    ...(progress && { actions_taken: steps.map(({ call, result }) => ({ action: call.name, arguments: call.args, result })) }),
    screen: {
      route: context?.screen.path ?? "",
      ...(context?.screen.area && { area: context.screen.area.description }),
      elements: listed.map((e) => ({ key: e.key, description: e.description, ...(e.hint && { hint: e.hint }) })),
      ...(picture && { picture: ref }),
    },
    ...(context?.extra && { app_facts: context.extra }),
    actions: Object.fromEntries(candidates.map((c) => [c.name, c.description])),
  };
  const questions = questionsFor(candidates, elements, progress, picture !== null);
  if (canLook) questions["on_screen"] = ON_SCREEN;
  return { state, questions, candidates, elements, steps, picture, ref, canLook };
}

async function askJev(
  query: Query,
  options: JevRouterOptions,
  doFetch: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<{ answers: Record<string, JevAnswer>; model: string }> {
  const baseURL = (options.baseURL ?? "https://api.typesafe.ai").replace(/\/+$/, "");
  const res = await doFetch(`${baseURL}/v1/systemone`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${options.apiKey}`,
      ...(query.picture && { "TypeSafe-Danger-Zone-Images": "true" }),
    },
    body: JSON.stringify({
      model: options.model ?? "jev-latest",
      state: query.state,
      questions: query.questions,
      ...(query.picture && { assets: { [query.ref]: { type: "image", ...query.picture } } }),
    }),
    ...(signal && { signal }),
  });
  if (!res.ok) throw new Error(`TypeSafe returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { answers?: unknown; model?: unknown };
  if (!body.answers || typeof body.answers !== "object") throw new Error("TypeSafe returned no answers");
  return { answers: body.answers as Record<string, JevAnswer>, model: typeof body.model === "string" ? body.model : "jev" };
}

function outcome(answers: Record<string, JevAnswer>, query: Query, threshold: number, reply: (calls: RoutedCall[]) => string): Outcome {
  const noul = (id: string): number => (answers[id]?.type === "noul" ? answers[id].noul : 0);
  const choice = (id: string): string | undefined => (answers[id]?.type === "choice" ? answers[id].choice : undefined);
  const { candidates, elements, steps } = query;

  if (steps.length > 0 && noul("done") >= threshold) {
    return { route: "self", reason: "done", content: reply(steps.map((a) => a.call)), toolCalls: [] };
  }

  const pick = (): RoutedCall | Reason => {
    if (noul("self") < threshold) return "needs-llm";
    const picked = candidates.find((c) => c.name === choice("tool"));
    if (!picked) return "unsure";
    const ids = ["tool", ...picked.args.map((a) => (a.kind === "target" ? "target" : `${picked.name}.${a.name}`))];
    if (ids.some((id) => sure(answers[id]) < threshold)) return "unsure";
    const args: Record<string, unknown> = {};
    for (const a of picked.args) {
      if (a.kind === "flag") {
        args[a.name] = noul(`${picked.name}.${a.name}`) >= 0.5;
        continue;
      }
      const value = a.kind === "target" ? choice("target") : choice(`${picked.name}.${a.name}`);
      const valid = value !== undefined && (a.kind === "target" ? value in elements : a.values.includes(value));
      if (!valid) return "unsure";
      args[a.name] = value;
    }
    const call: RoutedCall = { id: newCallId(), name: picked.name, args };
    return steps.some((a) => sameCall(a.call, call)) ? "repeat" : call;
  };

  const step = pick();
  if (typeof step !== "string") return { route: "self", reason: "act", content: null, toolCalls: [step] };
  if (query.canLook && noul("on_screen") >= LOOK_AT) {
    return { route: "self", reason: "look", content: null, toolCalls: [{ id: newCallId(), name: LOOK_TOOL, args: { actions: [] } }] };
  }
  return { route: "llm", reason: step };
}

/**
 * A `createPilotHandler` router that puts TypeSafe's Jev in front of the LLM:
 * Jev runs plain on-screen actions itself and hands everything else to the LLM,
 * which then keeps the rest of the turn. Jev errors fall through to the LLM.
 */
export function jevRouter(options: JevRouterOptions): PilotRouter {
  const allowed = options.tools ?? DEFAULT_TOOLS;
  const threshold = options.threshold ?? 0.7;
  const maxSteps = options.maxSteps ?? 3;
  const reply = options.reply ?? defaultReply;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const route = (event: JevRouteEvent, decision: RouteDecision): RouteDecision => {
    options.onRoute?.(event);
    return decision;
  };

  return async (input) => {
    const query = queryFor(input, allowed, maxSteps, options.look !== false);
    if (typeof query === "string") return route({ route: "llm", reason: query }, { route: "llm" });
    let jev: Awaited<ReturnType<typeof askJev>>;
    try {
      jev = await askJev(query, options, doFetch, input.signal);
    } catch (error) {
      return route({ route: "llm", reason: "error", error }, { route: "llm" });
    }
    const out = outcome(jev.answers, query, threshold, reply);
    if (out.route === "llm") return route({ route: "llm", reason: out.reason, answers: jev.answers }, { route: "llm" });
    return route(
      { route: "self", reason: out.reason, answers: jev.answers },
      { route: "self", model: jev.model, content: out.content, toolCalls: out.toolCalls },
    );
  };
}
