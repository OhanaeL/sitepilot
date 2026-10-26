export const MAX_ACTIONS = 8;
export const COORD_MAX = 999;
export const MAX_WAIT_MS = 1000;

export type Action =
  | { do: "click"; x: number; y: number }
  | { do: "type"; text: string }
  | { do: "scroll"; dy: number; x?: number; y?: number }
  | { do: "wait"; ms: number };

export interface Batch {
  actions: Action[];
}

export const SCHEMA = {
  type: "object",
  required: ["actions"],
  additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      maxItems: MAX_ACTIONS,
      description: "Run in order. Stops at the first failure. Empty captures without acting.",
      items: {
        type: "object",
        required: ["do"],
        additionalProperties: false,
        properties: {
          do: {
            enum: ["click", "type", "scroll", "wait"],
            description: "click needs x and y; type needs text; scroll needs dy; wait needs ms",
          },
          x: { type: "integer", minimum: 0, maximum: COORD_MAX },
          y: { type: "integer", minimum: 0, maximum: COORD_MAX },
          text: { type: "string", maxLength: 1000 },
          dy: { type: "integer", minimum: -10, maximum: 10, description: "Wheel notches; negative scrolls up." },
          ms: {
            type: "integer",
            minimum: 0,
            maximum: MAX_WAIT_MS,
            description: "Pause before the next action. 200 is enough for most repaints.",
          },
        },
      },
    },
  },
} as const;

export const REJECTED = `Your \`actions\` were rejected and NOTHING ran. Each action is an object whose \`do\` decides its other fields:

  {"do":"click",  "x":500, "y":300}   x and y required, 0-999
  {"do":"type",   "text":"acme"}      types into the field you clicked last
  {"do":"scroll", "dy":-3}            x and y optional
  {"do":"wait",   "ms":200}

Send the whole corrected batch in one call.`;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function parseAction(raw: unknown, index: number): Action {
  if (!raw || typeof raw !== "object") throw new Error(`action ${index} is not an object`);
  const a = raw as Record<string, unknown>;
  switch (a["do"]) {
    case "click":
      if (!isInt(a["x"], 0, COORD_MAX) || !isInt(a["y"], 0, COORD_MAX)) {
        throw new Error(`action ${index}: click needs integer x and y in 0-${COORD_MAX}`);
      }
      return { do: "click", x: a["x"], y: a["y"] };
    case "type":
      if (typeof a["text"] !== "string") throw new Error(`action ${index}: type needs text`);
      return { do: "type", text: a["text"].slice(0, 1000) };
    case "scroll": {
      if (!isInt(a["dy"], -10, 10)) throw new Error(`action ${index}: scroll needs integer dy in -10..10`);
      const out: Action = { do: "scroll", dy: a["dy"] };
      if (isInt(a["x"], 0, COORD_MAX) && isInt(a["y"], 0, COORD_MAX)) Object.assign(out, { x: a["x"], y: a["y"] });
      return out;
    }
    case "wait":
      if (!isInt(a["ms"], 0, MAX_WAIT_MS))
        throw new Error(`action ${index}: wait needs integer ms in 0-${MAX_WAIT_MS}`);
      return { do: "wait", ms: a["ms"] };
    default:
      throw new Error(`action ${index}: unknown do "${String(a["do"])}"`);
  }
}

export function parseBatch(args: Record<string, unknown>): Batch {
  const raw = args["actions"];
  if (raw === undefined) return { actions: [] };
  if (!Array.isArray(raw)) throw new Error("actions must be an array");
  if (raw.length > MAX_ACTIONS) throw new Error(`at most ${MAX_ACTIONS} actions per call`);
  return { actions: raw.map(parseAction) };
}
