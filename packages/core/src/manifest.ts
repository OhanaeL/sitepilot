import type { Tier } from "./attrs";

export interface ManifestElement {
  /** Any CSS selector: `.btn-new-project`, `nav a[href="/settings"]`, `#search`. */
  selector: string;
  /**
   * The label the model targets. Templates fill per match: `{text}` (the
   * element's text), `{text:.title}` (a descendant's text), `{attr:data-id}`,
   * `{value}` (form value), `{placeholder}`, `{href}`, `{alt}`, `{title}`.
   */
  label: string;
  /** Default "ambient". */
  tier?: Tier;
  hint?: string;
  /** Expose the element's rendered text. */
  read?: boolean;
}

export interface ManifestArea {
  selector: string;
  topic: string;
  description: string;
}

/**
 * Site-wide agent config, so markup stays clean. Load it with the `manifest`
 * option (an object or a URL such as `/pilot.json`). Anything here is public —
 * the browser fetches it — so keep private guidance in the server's `prompt.hints`.
 */
export interface PilotManifest {
  elements?: ManifestElement[];
  areas?: ManifestArea[];
  /** Hints by label, for attribute-marked and manifest-marked elements alike. */
  hints?: Record<string, string>;
  /** Base instructions; `createPilot({ systemPrompt })` wins if both are set. */
  systemPrompt?: string;
}

export interface ManifestRule extends ManifestElement {
  tier: Tier;
}

let rules: ManifestRule[] = [];
let areas: ManifestArea[] = [];
let combinedSelector = "";
let manifest: PilotManifest | null = null;

function selectorParses(selector: string): boolean {
  try {
    document.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

// One unparsable selector would poison the combined selector, so invalid rules are dropped up front.
export function setManifest(next: PilotManifest | null): void {
  manifest = next;
  const usable = (next?.elements ?? []).filter((e) => {
    const ok = typeof document === "undefined" || selectorParses(e.selector);
    if (!ok) console.warn(`sitepilot manifest: ignoring invalid selector ${JSON.stringify(e.selector)}`);
    return ok;
  });
  rules = usable.map((e) => ({ ...e, tier: e.tier ?? "ambient" }));
  areas = next?.areas ?? [];
  combinedSelector = rules.map((r) => r.selector).join(", ");
}

export const getManifest = (): PilotManifest | null => manifest;
export const manifestRules = (): readonly ManifestRule[] => rules;
export const manifestAreas = (): readonly ManifestArea[] => areas;
export const manifestSelector = (): string => combinedSelector;

export function manifestRuleFor(el: Element): ManifestRule | null {
  return rules.find((r) => safeMatches(el, r.selector)) ?? null;
}

export function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

export function safeQueryAll<T extends Element>(root: ParentNode, selector: string): T[] {
  try {
    return Array.from(root.querySelectorAll<T>(selector));
  } catch {
    return [];
  }
}

const collapse = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

function fieldValue(el: Element): string {
  if (el instanceof HTMLInputElement) return el.type === "password" ? "" : el.value;
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLSelectElement) return el.selectedOptions[0]?.text ?? el.value;
  return "";
}

/** Fill a label template for one matched element. Unknown placeholders resolve to "". */
export function renderLabel(template: string, el: Element): string {
  return collapse(
    template.replace(/\{([a-z]+)(?::([^}]+))?\}/g, (_m, kind: string, arg?: string) => {
      switch (kind) {
        case "text":
          return collapse(arg ? (el.querySelector(arg)?.textContent ?? "") : el.textContent);
        case "attr":
          return arg ? collapse(el.getAttribute(arg)) : "";
        case "value":
          return collapse(fieldValue(el));
        case "placeholder":
        case "href":
        case "alt":
        case "title":
          return collapse(el.getAttribute(kind));
        default:
          return "";
      }
    }),
  );
}

/** Fetch a manifest from a URL, or pass an object through. */
export async function loadManifest(
  source: PilotManifest | string,
  doFetch: typeof fetch = globalThis.fetch,
): Promise<PilotManifest> {
  if (typeof source !== "string") return source;
  const res = await doFetch(source);
  if (!res.ok) throw new Error(`manifest ${source}: HTTP ${res.status}`);
  return (await res.json()) as PilotManifest;
}
