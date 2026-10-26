import { driver, type Driver } from "driver.js";
import { resolveKey } from "./dom";
import { beginAgentAction, endAgentAction } from "./events";
import { ensureStyles } from "./styles";

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface ActOptions {
  /** The scan's root (`scan.root`), so keys resolve against what the prompt listed. */
  root?: ParentNode | undefined;
  /** Once aborted, the action gives up without touching the page. */
  signal?: AbortSignal | undefined;
}

export interface HighlightOptions extends ActOptions {
  title?: string;
  description?: string;
  /** Fires once if the user clicks the highlighted element. */
  onAdvance?: () => void;
  /** Fires once if the user dismisses the spotlight without clicking the element. */
  onCancel?: () => void;
  waitMs?: number;
}

const ELEMENT_WAIT_MS = 1500;
const SCROLL_SETTLE_MS = 800;
const POPOVER_EDGE_MARGIN_PX = 24;
const RING_Z_INDEX = 10001;
const RING_INSET_PX = 4;
const NOT_ON_SCREEN = "That element isn't on this screen right now.";
const STOPPED: ActionResult = { ok: false, reason: "The user stopped it." };

let active: Driver | null = null;
let advanceCleanup: (() => void) | null = null;
let trackCleanup: (() => void) | null = null;

export function clearHighlight(): void {
  advanceCleanup?.();
  advanceCleanup = null;
  trackCleanup?.();
  trackCleanup = null;
  active?.destroy();
  active = null;
}

// driver.js re-anchors only on window scroll; a target inside a scrolling or
// resizing container (a carousel, a collapsing panel) would drift out of the
// cutout, so every capture-phase scroll and any size change refreshes it.
function trackTarget(el: HTMLElement): () => void {
  let pending = false;
  const refresh = () => {
    if (pending || !active) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      active?.refresh();
    }, 50);
  };
  window.addEventListener("scroll", refresh, true);
  window.addEventListener("resize", refresh);
  const observer = new ResizeObserver(refresh);
  observer.observe(el);
  return () => {
    window.removeEventListener("scroll", refresh, true);
    window.removeEventListener("resize", refresh);
    observer.disconnect();
  };
}

function nudgePopoverFromEdges(): void {
  const pop = document.querySelector<HTMLElement>(".driver-popover");
  if (!pop) return;
  const rect = pop.getBoundingClientRect();
  const m = POPOVER_EDGE_MARGIN_PX;
  const dx = rect.left < m ? m - rect.left : rect.right > innerWidth - m ? innerWidth - m - rect.right : 0;
  const dy = rect.top < m ? m - rect.top : rect.bottom > innerHeight - m ? innerHeight - m - rect.bottom : 0;
  if (dx) pop.style.left = `${parseFloat(pop.style.left || "0") + dx}px`;
  if (dy) pop.style.top = `${parseFloat(pop.style.top || "0") + dy}px`;
}

// driver.js only re-anchors on window scroll, so the spotlight must be staged
// after any nested-container smooth scroll has settled.
function scrollIntoViewSettled(el: HTMLElement): Promise<void> {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return new Promise((resolve) => {
    const start = performance.now();
    let last = Number.NaN;
    let stable = 0;
    // rAF is paused in background tabs, so a timer backstop keeps the action from hanging.
    const backstop = setTimeout(resolve, SCROLL_SETTLE_MS + 50);
    const tick = () => {
      const { top } = el.getBoundingClientRect();
      stable = Math.abs(top - last) < 0.5 ? stable + 1 : 0;
      last = top;
      if (stable >= 3 || performance.now() - start > SCROLL_SETTLE_MS) {
        clearTimeout(backstop);
        resolve();
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function createClickRing(el: HTMLElement): () => void {
  const ring = document.createElement("div");
  ring.setAttribute("aria-hidden", "true");
  Object.assign(ring.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: String(RING_Z_INDEX),
    border: "2px dotted var(--sitepilot-accent, currentColor)",
    borderRadius: getComputedStyle(el).borderRadius,
  });
  const sync = () => {
    const rect = el.getBoundingClientRect();
    ring.style.top = `${rect.top - RING_INSET_PX}px`;
    ring.style.left = `${rect.left - RING_INSET_PX}px`;
    ring.style.width = `${rect.width + RING_INSET_PX * 2}px`;
    ring.style.height = `${rect.height + RING_INSET_PX * 2}px`;
  };
  sync();
  document.body.appendChild(ring);
  window.addEventListener("scroll", sync, true);
  window.addEventListener("resize", sync);
  const observer = new ResizeObserver(sync);
  observer.observe(el);
  return () => {
    window.removeEventListener("scroll", sync, true);
    window.removeEventListener("resize", sync);
    observer.disconnect();
    ring.remove();
  };
}

function waitForKey(key: string, timeoutMs: number, { root, signal }: ActOptions): Promise<HTMLElement | null> {
  const immediate = resolveKey(key, root);
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const el = signal?.aborted ? null : resolveKey(key, root);
      if (el || signal?.aborted || Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(el);
      }
    }, 80);
  });
}

export async function highlight(key: string, opts: HighlightOptions = {}): Promise<ActionResult> {
  const el = await waitForKey(key, opts.waitMs ?? ELEMENT_WAIT_MS, opts);
  if (opts.signal?.aborted) return STOPPED;
  if (!el) return { ok: false, reason: NOT_ON_SCREEN };

  ensureStyles();
  clearHighlight();
  await scrollIntoViewSettled(el);
  if (opts.signal?.aborted) return STOPPED;

  let settled = false;
  const settleWith = (cb?: () => void) => {
    if (settled) return;
    settled = true;
    advanceCleanup?.();
    trackCleanup?.();
    trackCleanup = null;
    active?.destroy();
    active = null;
    cb?.();
  };

  active = driver({
    animate: true,
    overlayOpacity: 0.65,
    stagePadding: 6,
    disableActiveInteraction: false,
    onHighlighted: () => {
      nudgePopoverFromEdges();
      setTimeout(nudgePopoverFromEdges, 100);
    },
    onDestroyStarted: () => {
      const wasSettled = settled;
      settled = true;
      advanceCleanup?.();
      trackCleanup?.();
      trackCleanup = null;
      active?.destroy();
      active = null;
      if (!wasSettled) opts.onCancel?.();
    },
  });
  // Popover buttons must be set here: driver's standalone highlight() stamps
  // `showButtons: []` over the driver-level config.
  active.highlight({
    element: el,
    disableActiveInteraction: false,
    popover: {
      ...(opts.title !== undefined && { title: opts.title }),
      ...(opts.description !== undefined && { description: opts.description }),
      showButtons: ["close"],
    },
  });
  trackCleanup = trackTarget(el);

  if (opts.onAdvance) {
    const removeRing = createClickRing(el);
    const advance = () => settleWith(opts.onAdvance);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") advance();
    };
    el.addEventListener("click", advance);
    el.addEventListener("pointerup", advance);
    el.addEventListener("keydown", onKeyDown);
    advanceCleanup = () => {
      el.removeEventListener("click", advance);
      el.removeEventListener("pointerup", advance);
      el.removeEventListener("keydown", onKeyDown);
      removeRing();
      advanceCleanup = null;
    };
  }

  return { ok: true };
}

export async function click(key: string, opts: ActOptions = {}): Promise<ActionResult> {
  const el = await waitForKey(key, ELEMENT_WAIT_MS, opts);
  if (opts.signal?.aborted) return STOPPED;
  if (!el) return { ok: false, reason: NOT_ON_SCREEN };
  clearHighlight();
  await scrollIntoViewSettled(el);
  if (opts.signal?.aborted) return STOPPED;
  beginAgentAction();
  try {
    el.click();
  } finally {
    endAgentAction();
  }
  return { ok: true };
}

export async function fill(key: string, text: string, opts: ActOptions = {}): Promise<ActionResult> {
  const el = await waitForKey(key, ELEMENT_WAIT_MS, opts);
  if (opts.signal?.aborted) return STOPPED;
  if (!el) return { ok: false, reason: "That field isn't on this screen right now." };
  const field =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el
      : el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!field) return { ok: false, reason: "That target isn't a text field." };
  clearHighlight();
  await scrollIntoViewSettled(field);
  if (opts.signal?.aborted) return STOPPED;
  field.focus();
  // Native setter + input event so React/Vue controlled inputs pick the value up.
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  beginAgentAction();
  try {
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  } finally {
    endAgentAction();
  }
  return { ok: true };
}
