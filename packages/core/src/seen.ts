import { scanTiers, type ScanOptions } from "./dom";
import type { Tier } from "./attrs";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** `visible`: the user can see some of it. `hidden`: covered by the page, clipped or transparent. `offscreen`: scrolled out of view, including under a fixed or sticky layer. */
export type Sighting = "visible" | "hidden" | "offscreen";

export interface SeenElement {
  key: string;
  tier: Tier;
  el: HTMLElement;
  sighting: Sighting;
  box: Rect;
}

export interface ShowSeenOptions {
  scan?: ScanOptions | undefined;
  /** Whether the model can pull the item tier right now. Default true. */
  items?: () => boolean;
  /** The prompt's own cap on ambient elements (`maxEmbeddedElements`), applied after the scan's. */
  embedded?: number;
}

const ROOT_ATTR = "data-sitepilot-seen";
const Z_INDEX = 9999;
const SAMPLE_COLS = 5;
const SAMPLE_ROWS = 4;
const REFRESH_MS = 100;
const ACCENT = "var(--sitepilot-accent, #2563eb)";
const HIDDEN = "#dc2626";
const HATCH = `repeating-linear-gradient(45deg, ${HIDDEN}33 0 4px, ${HIDDEN}11 4px 8px)`;

const rectOf = (r: DOMRect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const viewport = (): Rect => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });

function intersect(a: Rect, b: Rect): Rect | null {
  const r = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return r.right > r.left && r.bottom > r.top ? r : null;
}

const CLIPS = /(hidden|clip|scroll|auto)/;

// While <html> has visible overflow, <body>'s overflow applies to the viewport,
// so <body> itself clips nothing.
const overflows = (s: CSSStyleDeclaration) => CLIPS.test(`${s.overflowX} ${s.overflowY}`);

function clips(p: HTMLElement, s: CSSStyleDeclaration): boolean {
  if (!overflows(s)) return false;
  return p !== document.body || overflows(getComputedStyle(document.documentElement));
}

function clipAndOpacity(el: HTMLElement, box: Rect): { clip: Rect | null; transparent: boolean } {
  let clip = intersect(box, viewport());
  const own = getComputedStyle(el);
  let transparent = own.visibility === "hidden" || own.opacity === "0";
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.opacity === "0") transparent = true;
    if (clip && clips(p, s)) clip = intersect(clip, rectOf(p.getBoundingClientRect()));
  }
  return { clip, transparent };
}

// The overlay and driver.js's dimming layer are ours, not the page's: hit
// testing looks through them so they never count as covering anything.
function topmost(x: number, y: number): Element | undefined {
  return document.elementsFromPoint(x, y).find((n) => !n.closest(`[${ROOT_ATTR}], .driver-overlay`));
}

function pinned(hit: Element, el: HTMLElement): boolean {
  for (let n: Element | null = hit; n && !n.contains(el); n = n.parentElement) {
    if (/^(fixed|sticky)$/.test(getComputedStyle(n).position)) return true;
  }
  return false;
}

function samples(area: Rect): Array<[x: number, y: number]> {
  return Array.from({ length: SAMPLE_ROWS * SAMPLE_COLS }, (_, i) => [
    area.left + (((i % SAMPLE_COLS) + 0.5) / SAMPLE_COLS) * (area.right - area.left),
    area.top + ((Math.floor(i / SAMPLE_COLS) + 0.5) / SAMPLE_ROWS) * (area.bottom - area.top),
  ]);
}

const isOwn = (hit: Element, el: HTMLElement) => el.contains(hit) || hit.contains(el);

function sightingIn(el: HTMLElement, clip: Rect): Sighting {
  let onlyPinned = true;
  for (const [x, y] of samples(clip)) {
    const hit = topmost(x, y);
    if (hit && isOwn(hit, el)) return "visible";
    if (!hit || !pinned(hit, el)) onlyPinned = false;
  }
  return onlyPinned ? "offscreen" : "hidden";
}

function underPinned(el: HTMLElement, area: Rect): boolean {
  return samples(area).every(([x, y]) => {
    const hit = topmost(x, y);
    return !!hit && !isOwn(hit, el) && pinned(hit, el);
  });
}

/** Every element the model is sent (same keys and cap as the prompt), and whether the user can see it. */
export function locateSeen(
  opts: { scan?: ScanOptions | undefined; items?: boolean; embedded?: number | undefined } = {},
): SeenElement[] {
  const tiers = scanTiers(opts.scan);
  const ambient = tiers.ambient.slice(0, opts.embedded);
  const list = opts.items === false ? ambient : [...ambient, ...tiers.item];
  return list.map(({ key, tier, el }) => {
    const box = rectOf(el.getBoundingClientRect());
    const inView = intersect(box, viewport());
    const { clip, transparent } = clipAndOpacity(el, box);
    const sighting: Sighting = !inView
      ? "offscreen"
      : clip && !transparent
        ? sightingIn(el, clip)
        : underPinned(el, inView)
          ? "offscreen"
          : "hidden";
    return { key, tier, el, sighting, box };
  });
}

const OUTLINE = ["outline-style", "outline-width", "outline-color", "outline-offset"] as const;
type Saved = Array<[value: string, priority: string]>;

function outline(el: HTMLElement, tier: Tier, saved: Map<HTMLElement, Saved>): void {
  if (!saved.has(el))
    saved.set(
      el,
      OUTLINE.map((p) => [el.style.getPropertyValue(p), el.style.getPropertyPriority(p)]),
    );
  const want = [tier === "ambient" ? "solid" : "dashed", "2px", ACCENT, "2px"];
  OUTLINE.forEach((p, i) => {
    if (el.style.getPropertyValue(p) !== want[i]) el.style.setProperty(p, want[i]!, "important");
  });
}

function restore(el: HTMLElement, s: Saved): void {
  OUTLINE.forEach((p, i) => {
    const [value, priority] = s[i]!;
    if (value) el.style.setProperty(p, value, priority);
    else el.style.removeProperty(p);
  });
}

function hatch(box: Rect): HTMLElement {
  const n = document.createElement("div");
  Object.assign(n.style, {
    position: "fixed",
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.right - box.left}px`,
    height: `${box.bottom - box.top}px`,
    border: `2px dashed ${HIDDEN}`,
    borderRadius: "4px",
    background: HATCH,
    boxSizing: "border-box",
  });
  return n;
}

let hideCurrent: (() => void) | null = null;

/**
 * Outline every element the model is sent, on the element itself so the page's
 * own layers cover it; hatched red on top where the model sees what the user
 * can't. Returns a function that removes it. One view at a time: a new call
 * removes the previous one.
 */
export function showSeen(opts: ShowSeenOptions = {}): () => void {
  if (typeof document === "undefined") return () => {};
  hideCurrent?.();
  const root = document.createElement("div");
  root.setAttribute(ROOT_ATTR, "");
  root.setAttribute("aria-hidden", "true");
  Object.assign(root.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: String(Z_INDEX) });
  document.documentElement.appendChild(root);

  const saved = new Map<HTMLElement, Saved>();
  let pending: ReturnType<typeof setTimeout> | null = null;
  const draw = () => {
    pending = null;
    const seen = locateSeen({ scan: opts.scan, items: opts.items?.() ?? true, embedded: opts.embedded });
    const outlined = new Set<HTMLElement>();
    for (const e of seen) {
      if (e.sighting !== "visible") continue;
      outline(e.el, e.tier, saved);
      outlined.add(e.el);
    }
    for (const [el, s] of saved) {
      if (outlined.has(el)) continue;
      restore(el, s);
      saved.delete(el);
    }
    root.replaceChildren(...seen.filter((e) => e.sighting === "hidden").map((e) => hatch(e.box)));
    observer.takeRecords();
  };
  const schedule = () => {
    pending ??= setTimeout(draw, REFRESH_MS);
  };
  const observer = new MutationObserver(schedule);

  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", schedule);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  draw();

  const hide = () => {
    if (hideCurrent !== hide) return;
    hideCurrent = null;
    if (pending) clearTimeout(pending);
    window.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
    observer.disconnect();
    for (const [el, s] of saved) restore(el, s);
    saved.clear();
    root.remove();
  };
  hideCurrent = hide;
  return hide;
}
