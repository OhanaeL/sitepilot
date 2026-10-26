import type { Tier } from "./attrs";

export interface ScreenElement {
  /** The key the model targets — the label, ordinal-suffixed on collision (`Project card #2`). */
  key: string;
  /** Label plus the field's current value or readable text, when present. */
  description: string;
  tier: Tier;
  /** `data-pilot-hint`: guidance for the model, never shown to the user. */
  hint?: string;
}

export interface AreaContext {
  topic: string;
  description: string;
}

export type EventType = "click" | "open" | "input";

export interface UserEvent {
  type: EventType;
  key: string;
  tier: Tier;
  at: number;
  lastMove: boolean;
}
