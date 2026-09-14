import { ANY_TIER_SELECTOR, CONTEXT_ATTR, HINT_ATTR, PANEL_ATTR, READ_ATTR, TIER_ATTR, type Tier } from "./attrs";

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

function readableContent(el: HTMLElement): string {
  return el.hasAttribute(READ_ATTR) ? clip(el.textContent ?? "", MAX_READ_LEN) : "";
}

interface Candidate {
  el: HTMLElement;
  label: string;
  tier: Tier;
}

function candidates(root: ParentNode, tiers: Tier[]): Candidate[] {
  const out: Candidate[] = [];
  for (const tier of tiers) {
    const attr = TIER_ATTR[tier];
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const label = (el.getAttribute(attr) ?? "").trim();
      if (label && isInteractable(el)) out.push({ el, label, tier });
    }
  }
  return out;
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

function toScreenElement({ el, label, tier, key }: Candidate & { key: string }): ScreenElement {
  const value = fieldValue(el) || readableContent(el);
  const hint = clip(el.getAttribute(HINT_ATTR) ?? "", MAX_HINT_LEN);
  return { key, description: value ? `${label}: “${value}”` : label, tier, ...(hint && { hint }) };
}

function scanTier(tier: Tier, opts: ScanOptions): ScreenElement[] {
  if (typeof document === "undefined") return [];
  const root = opts.root ?? document;
  return withKeys(candidates(root, [tier]))
    .map(toScreenElement)
    .slice(0, opts.maxElements ?? DEFAULT_MAX_ELEMENTS);
}

/** Both tiers in the one key namespace the model sees, with their nodes. Uncapped. */
export function scanAll(root?: ParentNode): ScannedElement[] {
  if (typeof document === "undefined") return [];
  return withKeys(candidates(root ?? document, ["ambient", "item"])).map((c) => ({ ...toScreenElement(c), el: c.el }));
}

/** Every visible `data-pilot` element — the baseline "what the user sees" sent each turn. */
export function scanAmbient(opts: ScanOptions = {}): ScreenElement[] {
  return scanTier("ambient", opts);
}

/** Every visible `data-pilot-item` element — pulled only when the model asks to look closer. */
export function scanItems(opts: ScanOptions = {}): ScreenElement[] {
  return scanTier("item", opts);
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

/** The innermost reachable `data-pilot-context` marker — a modal's context beats the page's. */
export function scanContext(root?: ParentNode): AreaContext | null {
  if (typeof document === "undefined") return null;
  const scope = root ?? document;
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>(`[${CONTEXT_ATTR.topic}]`)).filter(
    (el) => markerReachable(el) && (el.getAttribute(CONTEXT_ATTR.topic) ?? "").trim(),
  );
  const winner = nodes.reduce<HTMLElement | null>(
    (best, el) => (!best || depth(el) > depth(best) ? el : best),
    null,
  );
  if (!winner) return null;
  const topic = (winner.getAttribute(CONTEXT_ATTR.topic) ?? "").trim();
  const description = (winner.getAttribute(CONTEXT_ATTR.description) ?? "").trim() || topic;
  return { topic, description };
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
