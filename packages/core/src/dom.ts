import { ANY_TIER_SELECTOR, CONTEXT_ATTR, HINT_ATTR, PANEL_ATTR, READ_ATTR, TIER_ATTR, type Tier } from "./attrs";
import { manifestAreas, manifestRules, renderLabel, safeQueryAll } from "./manifest";

export interface ScreenElement {
  /** The key the model targets — the label, ordinal-suffixed on collision (`Project card #2`). */
  key: string;
  /** Label plus the field's current value or readable text, when present. */
  description: string;
  tier: Tier;
  /** `data-pilot-hint`: guidance for the model, never shown to the user. */
  hint?: string;
}

export interface ScannedElement extends ScreenElement {
  el: HTMLElement;
}

export interface AreaContext {
  topic: string;
  description: string;
}

export interface ScanOptions {
  /** Cap per scan so a long list cannot flood the prompt. Default 20. */
  maxElements?: number;
  root?: ParentNode;
}

const DEFAULT_MAX_ELEMENTS = 20;
const MAX_VALUE_LEN = 120;
const MAX_READ_LEN = 600;
const MAX_HINT_LEN = 400;
const MIN_CONTAINMENT_KEY_LEN = 4;

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * Visible AND reachable: an open modal marks everything outside itself
 * `aria-hidden`/`inert`, so those elements are on screen but not clickable.
 */
export function isInteractable(el: HTMLElement): boolean {
  if (!isVisible(el)) return false;
  if (el.closest(`[aria-hidden="true"], [inert], [${PANEL_ATTR}]`)) return false;
  return true;
}

function clip(value: string, max: number): string {
  const v = value.replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

function fieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) return el.type === "password" ? "" : clip(el.value, MAX_VALUE_LEN);
  if (el instanceof HTMLTextAreaElement) return clip(el.value, MAX_VALUE_LEN);
  if (el instanceof HTMLSelectElement) return clip(el.selectedOptions[0]?.text ?? el.value, MAX_VALUE_LEN);
  if (el.isContentEditable) return clip(el.textContent ?? "", MAX_VALUE_LEN);
  const inner = el.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    "input:not([type=password]), textarea",
  );
  return inner ? clip(inner.value, MAX_VALUE_LEN) : "";
}

function readableContent(el: HTMLElement, read: boolean): string {
  return read ? clip(el.textContent ?? "", MAX_READ_LEN) : "";
}

interface Candidate {
  el: HTMLElement;
  label: string;
  tier: Tier;
  hint: string;
  read: boolean;
}

// Attribute-marked elements and manifest matches merge into one DOM-ordered
// list; an element's own attribute label wins over a manifest template.
function candidates(root: ParentNode, tiers: Tier[]): Candidate[] {
  const found = new Map<HTMLElement, Candidate>();
  for (const tier of tiers) {
    const attr = TIER_ATTR[tier];
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const label = (el.getAttribute(attr) ?? "").trim();
      if (label && isInteractable(el)) {
        found.set(el, { el, label, tier, hint: el.getAttribute(HINT_ATTR) ?? "", read: el.hasAttribute(READ_ATTR) });
      }
    }
  }
  for (const rule of manifestRules()) {
    if (!tiers.includes(rule.tier)) continue;
    for (const el of safeQueryAll<HTMLElement>(root, rule.selector)) {
      if (!isInteractable(el)) continue;
      const own = found.get(el);
      if (own) {
        if (!own.hint && rule.hint) own.hint = rule.hint;
        own.read ||= rule.read ?? false;
        continue;
      }
      const attrLabel = (el.getAttribute(TIER_ATTR[rule.tier]) ?? "").trim();
      const label = attrLabel || renderLabel(rule.label, el);
      if (!label) continue;
      found.set(el, {
        el,
        label,
        tier: rule.tier,
        hint: el.getAttribute(HINT_ATTR) ?? rule.hint ?? "",
        read: el.hasAttribute(READ_ATTR) || (rule.read ?? false),
      });
    }
  }
  return Array.from(found.values()).sort((a, b) =>
    a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

// Ordinals are counted over one shared map across tiers: the model sees a
// single key namespace, so "X" in both tiers must become "X" and "X #2".
function withKeys(list: Candidate[]): Array<Candidate & { key: string }> {
  const counts = new Map<string, number>();
  return list.map((c) => {
    const n = (counts.get(c.label) ?? 0) + 1;
    counts.set(c.label, n);
    return { ...c, key: n === 1 ? c.label : `${c.label} #${n}` };
  });
}

function toScreenElement({ el, label, tier, key, hint: rawHint, read }: Candidate & { key: string }): ScreenElement {
  const value = fieldValue(el) || readableContent(el, read);
  const hint = clip(rawHint, MAX_HINT_LEN);
  return { key, description: value ? `${label}: “${value}”` : label, tier, ...(hint && { hint }) };
}

function scanTier(tier: Tier, opts: ScanOptions): ScannedElement[] {
  if (typeof document === "undefined") return [];
  const root = opts.root ?? document;
  return withKeys(candidates(root, ["ambient", "item"]))
    .filter((c) => c.tier === tier)
    .slice(0, opts.maxElements ?? DEFAULT_MAX_ELEMENTS)
    .map((c) => ({ ...toScreenElement(c), el: c.el }));
}

const withoutNode = ({ el: _, ...e }: ScannedElement): ScreenElement => e;

/** Each tier exactly as the model receives it (same keys, same cap), with the nodes. */
export function scanTiers(opts: ScanOptions = {}): Record<Tier, ScannedElement[]> {
  return { ambient: scanTier("ambient", opts), item: scanTier("item", opts) };
}

/** Both tiers in the one key namespace the model sees, with their nodes. Uncapped. */
export function scanAll(root?: ParentNode): ScannedElement[] {
  if (typeof document === "undefined") return [];
  return withKeys(candidates(root ?? document, ["ambient", "item"])).map((c) => ({ ...toScreenElement(c), el: c.el }));
}

/** Every visible `data-pilot` element — the baseline "what the user sees" sent each turn. */
export function scanAmbient(opts: ScanOptions = {}): ScreenElement[] {
  return scanTier("ambient", opts).map(withoutNode);
}

/** Every visible `data-pilot-item` element — pulled only when the model asks to look closer. */
export function scanItems(opts: ScanOptions = {}): ScreenElement[] {
  return scanTier("item", opts).map(withoutNode);
}

// The marker itself is usually a visually-hidden span carrying its own
// aria-hidden, so reachability is judged from its parent.
function markerReachable(el: HTMLElement): boolean {
  const host = el.parentElement ?? el;
  return !host.closest('[aria-hidden="true"], [inert]');
}

function depth(el: HTMLElement): number {
  let d = 0;
  for (let p = el.parentElement; p; p = p.parentElement) d++;
  return d;
}

/** The innermost reachable context marker (attribute or manifest area) — a modal's context beats the page's. */
export function scanContext(root?: ParentNode): AreaContext | null {
  if (typeof document === "undefined") return null;
  const scope = root ?? document;
  const markers: Array<{ el: HTMLElement; area: AreaContext }> = [];
  for (const el of scope.querySelectorAll<HTMLElement>(`[${CONTEXT_ATTR.topic}]`)) {
    const topic = (el.getAttribute(CONTEXT_ATTR.topic) ?? "").trim();
    if (topic && markerReachable(el)) {
      markers.push({ el, area: { topic, description: (el.getAttribute(CONTEXT_ATTR.description) ?? "").trim() || topic } });
    }
  }
  for (const area of manifestAreas()) {
    for (const el of safeQueryAll<HTMLElement>(scope, area.selector)) {
      if (markerReachable(el)) markers.push({ el, area: { topic: area.topic, description: area.description } });
    }
  }
  const winner = markers.reduce<(typeof markers)[number] | null>(
    (best, m) => (!best || depth(m.el) > depth(best.el) ? m : best),
    null,
  );
  return winner?.area ?? null;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Resolve a model-supplied key to a live element, re-deriving the same ordinal
 * keys a scan would. Falls back to a unique normalized-containment match, since
 * models routinely paraphrase or truncate long keys.
 */
export function resolveKey(key: string, root?: ParentNode): HTMLElement | null {
  const all = scanAll(root);

  const exact = all.find((c) => c.key === key);
  if (exact) return exact.el;

  const nk = norm(key);
  if (nk.length < MIN_CONTAINMENT_KEY_LEN) return null;
  const contained = all.filter((c) => {
    const ck = norm(c.key);
    return ck.includes(nk) || nk.includes(ck);
  });
  return contained.length === 1 ? contained[0]!.el : null;
}

export { ANY_TIER_SELECTOR };
