import { ANY_TIER_SELECTOR, TIER_ATTR, type Tier } from "./attrs";

export type EventType = "click" | "open" | "input";

export interface UserEvent {
  type: EventType;
  key: string;
  tier: Tier;
  at: number;
  lastMove: boolean;
}

const BUFFER_SIZE = 3;
const DEDUPE_MS = 500;
const AGENT_ACTION_TAIL_MS = 400;
const DIALOG_SELECTOR = '[role="dialog"], [role="menu"], [role="alertdialog"], [role="listbox"]';

let buffer: UserEvent[] = [];
const listeners = new Set<() => void>();
let installed = false;
let agentActingDepth = 0;
let agentActingUntil = 0;

function agentIsActing(): boolean {
  return agentActingDepth > 0 || Date.now() < agentActingUntil;
}

/** Pause user-event capture while the agent fires synthetic events. Always pair with `endAgentAction`. */
export function beginAgentAction(): void {
  agentActingDepth += 1;
  agentActingUntil = Date.now() + AGENT_ACTION_TAIL_MS;
}

export function endAgentAction(): void {
  agentActingDepth = Math.max(0, agentActingDepth - 1);
  agentActingUntil = Date.now() + AGENT_ACTION_TAIL_MS;
}

function emit(): void {
  for (const l of listeners) l();
}

function tierOf(el: Element): { tier: Tier; key: string } | null {
  for (const tier of ["item", "ambient"] as const) {
    const v = el.getAttribute(TIER_ATTR[tier])?.trim();
    if (v) return { tier, key: v };
  }
  return null;
}

function markedFrom(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(ANY_TIER_SELECTOR) : null;
}

function push(type: EventType, el: Element): void {
  const info = tierOf(el);
  if (!info) return;
  const now = Date.now();
  const head = buffer[0];
  const repeat =
    head?.type === type && head.key === info.key && (type === "input" || now - head.at < DEDUPE_MS);
  if (repeat) {
    buffer = [{ ...head, at: now }, ...buffer.slice(1)];
  } else {
    const demoted = buffer.map((e) => (e.lastMove ? { ...e, lastMove: false } : e));
    buffer = [{ type, key: info.key, tier: info.tier, at: now, lastMove: true }, ...demoted].slice(
      0,
      BUFFER_SIZE,
    );
  }
  emit();
}

function onClick(e: Event): void {
  if (agentIsActing()) return;
  const el = markedFrom(e.target);
  if (el) push("click", el);
}

function onInput(e: Event): void {
  if (agentIsActing()) return;
  const el = markedFrom(e.target);
  if (el) push("input", el);
}

function markedDialog(node: Element): Element | null {
  const dialog = node.matches(DIALOG_SELECTOR) ? node : node.querySelector(DIALOG_SELECTOR);
  return dialog?.matches(ANY_TIER_SELECTOR) ? dialog : null;
}

function onMutations(mutations: MutationRecord[]): void {
  if (agentIsActing()) return;
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (!(node instanceof Element)) continue;
      const marked = markedDialog(node);
      if (marked) {
        push("open", marked);
        return;
      }
    }
  }
}

/**
 * Install the page-lifetime listeners. Idempotent and never torn down: the
 * buffer must keep capturing across route changes that remount the widget.
 */
export function installEventsBuffer(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("click", onClick, { capture: true });
  document.addEventListener("input", onInput, { capture: true });
  new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true });
}

export function subscribeEvents(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getEvents(): UserEvent[] {
  return buffer;
}

export function clearEvents(): void {
  buffer = [];
  emit();
}
