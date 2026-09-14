export type Tier = "ambient" | "item";

/**
 * The DOM attribute contract. An element is known to the agent iff it carries
 * one of these and is currently mounted — there is no registry to keep in sync.
 *
 * | Attribute                       | Role                                              |
 * |---------------------------------|---------------------------------------------------|
 * | `data-pilot`                    | Ambient: chrome and form fields, sent every turn  |
 * | `data-pilot-item`               | Item: entity cards/rows, fetched on demand        |
 * | `data-pilot-read`               | Also expose the element's rendered text           |
 * | `data-pilot-context`            | Area grounding (what this view IS), never a target|
 * | `data-pilot-context-description`| Prose for the model to read about the area        |
 * | `data-pilot-panel`              | The agent's own UI — excluded from every scan     |
 *
 * The attribute VALUE is both the human description and the key the model
 * targets, so write it as a label a person would say: "Create Project button".
 */
export const TIER_ATTR: Record<Tier, string> = {
  ambient: "data-pilot",
  item: "data-pilot-item",
};

export const READ_ATTR = "data-pilot-read";
export const PANEL_ATTR = "data-pilot-panel";

export const CONTEXT_ATTR = {
  topic: "data-pilot-context",
  description: "data-pilot-context-description",
} as const;

export const ANY_TIER_SELECTOR = Object.values(TIER_ATTR)
  .map((a) => `[${a}]`)
  .join(", ");

/** Attribute props for an ambient element: `<button {...mark("Save button")}>`. */
export function mark(label: string): Record<string, string> {
  return { [TIER_ATTR.ambient]: label };
}

/** Attribute props for an on-demand item: `<li {...markItem(\`Project card: ${name}\`)}>`. */
export function markItem(label: string): Record<string, string> {
  return { [TIER_ATTR.item]: label };
}

/** Attribute props for a readable region the agent may quote from. */
export function markRead(label: string, tier: Tier = "ambient"): Record<string, string> {
  return { [TIER_ATTR[tier]]: label, [READ_ATTR]: "" };
}

/** Attribute props for an area-context marker. Render on any wrapper of the view. */
export function markContext(topic: string, description: string): Record<string, string> {
  return { [CONTEXT_ATTR.topic]: topic, [CONTEXT_ATTR.description]: description };
}

/** Attribute props for the agent's own panel so it never scans itself. */
export function markPanel(): Record<string, string> {
  return { [PANEL_ATTR]: "" };
}
