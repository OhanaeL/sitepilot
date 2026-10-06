import { scanAll, type ScannedElement, type Tier } from "@sitepilot/core";
import { COORD_MAX } from "./batch";

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameElement {
  key: string;
  description: string;
  tier: Tier;
  rect: NormRect;
  el: HTMLElement;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface FrameRenderer {
  (elements: FrameElement[], viewport: Viewport): Promise<string | null>;
}

export type ElementRenderer = (el: HTMLElement) => Promise<CanvasImageSource>;

const TIER_COLOR: Record<Tier, string> = { ambient: "#2563eb", item: "#d97706" };

export function viewport(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight };
}

const norm = (px: number, size: number): number => Math.max(0, Math.min(COORD_MAX, Math.round((px / size) * (COORD_MAX + 1))));

export function toNormRect(r: DOMRect, vp: Viewport): NormRect {
  const x = norm(r.left, vp.w);
  const y = norm(r.top, vp.h);
  return { x, y, w: Math.max(1, norm(r.right, vp.w) - x), h: Math.max(1, norm(r.bottom, vp.h) - y) };
}

function inViewport(r: DOMRect, vp: Viewport): boolean {
  return r.right > 0 && r.bottom > 0 && r.left < vp.w && r.top < vp.h;
}

/** Marked, reachable elements inside the viewport with normalized rects — the only things the frame ever shows. */
export function frameElements(vp: Viewport, root?: ParentNode): FrameElement[] {
  return scanAll(root).flatMap((e: ScannedElement) => {
    const r = e.el.getBoundingClientRect();
    return inViewport(r, vp) ? [{ ...e, rect: toNormRect(r, vp) }] : [];
  });
}

// Innermost box wins — a card's button over the card itself.
const innermost = (hits: FrameElement[]): FrameElement => hits.reduce((best, e) => (best.el.contains(e.el) ? e : best));

/** The marked element under a normalized point, or null when nothing opted-in is there. */
export function elementAt(x: number, y: number, vp: Viewport, root?: ParentNode): FrameElement | null {
  const px = ((x + 0.5) / (COORD_MAX + 1)) * vp.w;
  const py = ((y + 0.5) / (COORD_MAX + 1)) * vp.h;
  const candidates = frameElements(vp, root);
  const hits = candidates.filter((e) => {
    const r = e.el.getBoundingClientRect();
    return px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
  });
  if (hits.length === 0) return null;
  const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(px, py) : [];
  for (const node of stack) {
    const covering = hits.filter((e) => e.el.contains(node));
    if (covering.length > 0) return innermost(covering);
  }
  return innermost(hits);
}

export interface SchematicOptions {
  maxEdge?: number;
  renderElement?: ElementRenderer;
}

function valueOf(e: FrameElement): string {
  const i = e.description.indexOf(": “");
  return i === -1 ? "" : e.description.slice(i + 3).replace(/”$/, "");
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo === 0 ? "" : `${text.slice(0, lo)}…`;
}

/**
 * Draw the frame the model sees: a blank viewport with only the opted-in
 * elements on it. Without `renderElement` each element is a labelled box; with
 * it (e.g. html-to-image's `toCanvas`) the element's own pixels are composited
 * at its rect — still nothing outside the marked boxes.
 */
export function schematicRenderer(opts: SchematicOptions = {}): FrameRenderer {
  const maxEdge = opts.maxEdge ?? 1024;
  return async (elements, vp) => {
    if (typeof document === "undefined") return null;
    const s = Math.min(1, maxEdge / Math.max(vp.w, vp.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.w * s);
    canvas.height = Math.round(vp.h * s);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const font = Math.max(10, Math.round(12 * s));
    const px = (n: number, size: number): number => (n / (COORD_MAX + 1)) * size;

    for (const e of elements) {
      const x = px(e.rect.x, canvas.width);
      const y = px(e.rect.y, canvas.height);
      const w = Math.max(2, px(e.rect.w, canvas.width));
      const h = Math.max(2, px(e.rect.h, canvas.height));

      let painted = false;
      if (opts.renderElement) {
        try {
          ctx.drawImage(await opts.renderElement(e.el), x, y, w, h);
          painted = true;
        } catch {
          painted = false;
        }
      }
      if (!painted) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeStyle = TIER_COLOR[e.tier];
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);

      ctx.font = `bold ${font}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const label = fitText(ctx, e.key, Math.max(0, w - 6));
      const labelInside = h >= font + 6 && label.length > 0;
      const lx = x + 3;
      const ly = labelInside ? y + 3 : Math.max(0, y - font - 2);
      if (!labelInside) {
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillRect(lx - 2, ly - 1, ctx.measureText(fitText(ctx, e.key, canvas.width - lx)).width + 4, font + 2);
      }
      ctx.fillStyle = TIER_COLOR[e.tier];
      ctx.fillText(labelInside ? label : fitText(ctx, e.key, canvas.width - lx), lx, ly);

      const value = painted ? "" : valueOf(e);
      if (value && labelInside && h >= font * 2 + 8) {
        ctx.font = `${font}px system-ui, sans-serif`;
        ctx.fillStyle = "#374151";
        ctx.fillText(fitText(ctx, value, Math.max(0, w - 6)), lx, y + font + 5);
      }
    }
    return canvas.toDataURL("image/png");
  };
}
