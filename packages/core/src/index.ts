export {
  ANY_TIER_SELECTOR,
  CONTEXT_ATTR,
  HINT_ATTR,
  mark,
  markContext,
  markItem,
  markPanel,
  markRead,
  PANEL_ATTR,
  READ_ATTR,
  TIER_ATTR,
  type MarkOptions,
  type Tier,
} from "./attrs";
export {
  isInteractable,
  resolveKey,
  scanAll,
  scanAmbient,
  scanContext,
  scanItems,
  scanTiers,
  type ScanOptions,
  type ScannedElement,
} from "./dom";
export type { AreaContext, EventType, ScreenElement, UserEvent } from "./screen";
export {
  beginAgentAction,
  clearEvents,
  endAgentAction,
  getEvents,
  subscribeEvents,
} from "./events";
export {
  clearHighlight,
  click,
  fill,
  highlight,
  type ActionResult,
  type ActOptions,
  type HighlightOptions,
} from "./actions";
export { locateSeen, showSeen, type Rect, type SeenElement, type ShowSeenOptions, type Sighting } from "./seen";
export {
  defineTool,
  patchTool,
  type ContentPart,
  type DefineToolOptions,
  type PilotPlugin,
  type PilotTool,
  type PilotUser,
  type ToolCall,
  type ToolContext,
  type ToolOutput,
  type ToolSpec,
} from "./tools";
export { DEFAULT_STRINGS, type PilotStrings, type PilotStringsOverride } from "./strings";
export type { ManifestArea, ManifestElement, PilotManifest } from "./manifest";
export {
  ACTION_TOOLS,
  clickTool,
  fillTool,
  highlightTool,
  lookCloserTool,
  type ActionToolName,
  type BuiltinToolName,
  type BuiltinToolsOption,
} from "./builtin-tools";
export {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  hintFor,
  renderElement,
  renderScreen,
  renderUser,
  type Hints,
  type PromptContext,
  type PromptOptions,
  type ScreenContext,
} from "./prompt";
export {
  openaiTransport,
  parseCompletion,
  type ChatMessage,
  type CompletionReply,
  type CompletionRequest,
  type OpenAITransportOptions,
  type Transport,
  type WireToolCall,
} from "./transport";
export {
  createPilot,
  defaultTrim,
  type HistoryOptions,
  type Pilot,
  type PilotMessage,
  type PilotOptions,
  type PilotState,
} from "./pilot";
