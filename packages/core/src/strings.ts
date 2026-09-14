/** Every model-facing result string and transcript line the built-in tools produce. Override any subset via `strings`. */
export interface PilotStrings {
  highlighted(key: string): string;
  highlightFailed(key: string, reason: string): string;
  clicked(key: string): string;
  clickFailed(key: string, reason: string): string;
  filled(key: string, text: string): string;
  fillFailed(key: string, reason: string): string;
  noItems: string;
  toolNotEnabled(name: string): string;
  screenOff: string;
  unknownTool(name: string): string;
  toolThrew(name: string, message: string): string;
  attachmentsNote: string;
  screenshotOmitted: string;
  /** The synthetic user turn sent when the user clicks a highlighted element. */
  userClicked(key: string): string;
  activity: {
    highlighted(key: string): string;
    dismissed(key: string): string;
    clicked(key: string): string;
    clickFailed(key: string): string;
    filled(key: string, text: string): string;
    fillFailed(key: string): string;
    lookedAtItems: string;
    stoppedAfter(rounds: number): string;
  };
}

export const DEFAULT_STRINGS: PilotStrings = {
  highlighted: (key) =>
    `Done: highlighted "${key}" for the user. They act on it themselves — if they click it you'll receive "I clicked …" as their next message. Treat this step as delivered and finish your reply.`,
  highlightFailed: (key, reason) =>
    `That didn't work — couldn't highlight "${key}": ${reason} Pick a different element, or call get_screen_elements to look again.`,
  clicked: (key) => `Done: clicked "${key}" on the user's behalf.`,
  clickFailed: (key, reason) => `That didn't work — couldn't click "${key}": ${reason}`,
  filled: (key, text) => `Done: filled "${key}" with "${text}" on the user's behalf.`,
  fillFailed: (key, reason) => `That didn't work — couldn't fill "${key}": ${reason}`,
  noItems: "(no item elements are on screen right now)",
  toolNotEnabled: (name) =>
    `The "${name}" tool is not enabled by the user. Use only the tools offered this turn, or tell the user what to do themselves.`,
  screenOff: "The user has switched off every UI action, so the screen cannot be read. Answer from the conversation instead.",
  unknownTool: (name) => `Unknown tool "${name}".`,
  toolThrew: (name, message) => `Tool "${name}" failed: ${message}`,
  attachmentsNote: "Attached: media produced by the tool calls above.",
  screenshotOmitted: "[screenshot omitted — it was only valid for that turn]",
  userClicked: (key) => `I clicked "${key}".`,
  activity: {
    highlighted: (key) => `Highlighted ${key}`,
    dismissed: (key) => `Dismissed ${key}`,
    clicked: (key) => `Clicked ${key}`,
    clickFailed: (key) => `Couldn't click ${key}`,
    filled: (key, text) => `Entered "${text}" in ${key}`,
    fillFailed: (key) => `Couldn't fill ${key}`,
    lookedAtItems: "Looked at the items on screen",
    stoppedAfter: (rounds) => `Stopped after ${rounds} steps`,
  },
};

export type PilotStringsOverride = Partial<Omit<PilotStrings, "activity">> & { activity?: Partial<PilotStrings["activity"]> };

export function mergeStrings(override?: PilotStringsOverride): PilotStrings {
  if (!override) return DEFAULT_STRINGS;
  const { activity, ...rest } = override;
  return { ...DEFAULT_STRINGS, ...rest, activity: { ...DEFAULT_STRINGS.activity, ...activity } };
}
