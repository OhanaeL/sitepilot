import { driver, type Driver } from "driver.js";
import { resolveKey } from "./dom";
import { beginAgentAction, endAgentAction } from "./events";
import { ensureStyles } from "./styles";

export interface ActionResult {
  ok: boolean;
  reason?: string;
}

export interface HighlightOptions {
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

let active: Driver | null = null;
let advanceCleanup: (() => void) | null = null;

export function clearHighlight(): void {
  advanceCleanup?.();
  advanceCleanup = null;
  active?.destroy();
  active = null;
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
    const tick = () => {
      const { top } = el.getBoundingClientRect();
      stable = Math.abs(top - last) < 0.5 ? stable + 1 : 0;
      last = top;
      if (stable >= 3 || performance.now() - start > SCROLL_SETTLE_MS) resolve();
      else requestAnimationFrame(tick);
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

function waitForKey(key: string, timeoutMs: number): Promise<HTMLElement | null> {
  const immediate = resolveKey(key);
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const el = resolveKey(key);
      if (el || Date.now() - start >= timeoutMs) {
        clearInterval(interval);
        resolve(el);
      }
    }, 80);
  });
}

export async function highlight(key: string, opts: HighlightOptions = {}): Promise<ActionResult> {
  const el = await waitForKey(key, opts.waitMs ?? ELEMENT_WAIT_MS);
  if (!el) return { ok: false, reason: NOT_ON_SCREEN };

  ensureStyles();
  clearHighlight();
  await scrollIntoViewSettled(el);

  let settled = false;
  const settleWith = (cb?: () => void) => {
    if (settled) return;
    settled = true;
    advanceCleanup?.();
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

export async function click(key: string): Promise<ActionResult> {
  const el = await waitForKey(key, ELEMENT_WAIT_MS);
  if (!el) return { ok: false, reason: NOT_ON_SCREEN };
  clearHighlight();
  await scrollIntoViewSettled(el);
  beginAgentAction();
  try {
    el.click();
  } finally {
    endAgentAction();
  }
  return { ok: true };
}

export async function fill(key: string, text: string): Promise<ActionResult> {
  const el = await waitForKey(key, ELEMENT_WAIT_MS);
  if (!el) return { ok: false, reason: "That field isn't on this screen right now." };
  const field =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el
      : el.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (!field) return { ok: false, reason: "That target isn't a text field." };
  clearHighlight();
  await scrollIntoViewSettled(field);
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
