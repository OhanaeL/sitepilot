import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { scanAmbient, scanItems, scanTiers } from "../src/dom";
import { locateSeen, showSeen } from "../src/seen";

const at = (el: Element, left: number, top: number, width: number, height: number) => {
  el.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
};

const byId = (id: string) => document.getElementById(id)!;
let hits: (x: number, y: number) => Element[] = () => [];

beforeEach(() => {
  document.body.innerHTML = "";
  hits = () => [];
  document.elementsFromPoint = (x: number, y: number) => hits(x, y);
});

afterEach(() => {
  document.querySelector("[data-sitepilot-seen]")?.remove();
});

describe("scanTiers", () => {
  test("matches what the prompt and get_screen_elements send, keys and cap included", () => {
    document.body.innerHTML = `
      <b data-pilot="Save"></b><b data-pilot="Save"></b><b data-pilot="Extra"></b>
      <i data-pilot-item="Card"></i><i data-pilot-item="Card"></i>`;
    const tiers = scanTiers({ maxElements: 2 });
    expect(tiers.ambient.map((e) => e.key)).toEqual(scanAmbient({ maxElements: 2 }).map((e) => e.key));
    expect(tiers.item.map((e) => e.key)).toEqual(scanItems({ maxElements: 2 }).map((e) => e.key));
    expect(tiers.ambient.map((e) => e.key)).toEqual(["Save", "Save #2"]);
  });
});

describe("locateSeen", () => {
  test("an unobstructed element is visible", () => {
    document.body.innerHTML = `<button id="a" data-pilot="Save"></button>`;
    at(byId("a"), 100, 100, 200, 40);
    hits = () => [byId("a")];
    expect(locateSeen()[0]).toMatchObject({ key: "Save", sighting: "visible" });
  });

  test("partly under a fixed header is still visible", () => {
    document.body.innerHTML = `
      <header id="h" style="position: fixed"><a id="link">Home</a></header>
      <section id="s" data-pilot="Projects"></section>`;
    at(byId("s"), 0, 20, 400, 200);
    hits = (_x, y) => (y < 60 ? [byId("link"), byId("h")] : [byId("s")]);
    expect(locateSeen()[0]?.sighting).toBe("visible");
  });

  test("covered everywhere by the page itself is hidden from the user", () => {
    document.body.innerHTML = `<div id="m" style="position: absolute"></div><button id="a" data-pilot="Save"></button>`;
    at(byId("a"), 100, 100, 200, 40);
    hits = () => [byId("m")];
    expect(locateSeen()[0]?.sighting).toBe("hidden");
  });

  test("tucked under a sticky header or fixed panel counts as scrolled out of view", () => {
    document.body.innerHTML = `<header id="h" style="position: sticky"><a id="link"></a></header><a id="a" data-pilot="Read more"></a>`;
    at(byId("a"), 100, 20, 200, 20);
    hits = () => [byId("link")];
    expect(locateSeen()[0]?.sighting).toBe("offscreen");
  });

  test("the overlay and driver's dimming layer never count as covers", () => {
    document.body.innerHTML = `
      <div data-sitepilot-seen><b id="o"></b></div><div class="driver-overlay"><b id="d"></b></div>
      <button id="a" data-pilot="Save"></button>`;
    at(byId("a"), 100, 100, 200, 40);
    hits = () => [byId("o"), byId("d"), byId("a")];
    expect(locateSeen()[0]?.sighting).toBe("visible");
  });

  test("scrolled out of the viewport is offscreen", () => {
    document.body.innerHTML = `<button id="a" data-pilot="Footer link"></button>`;
    at(byId("a"), 0, innerHeight + 500, 100, 20);
    expect(locateSeen()[0]?.sighting).toBe("offscreen");
  });

  test("clipped away by a scrolling ancestor, or transparent, is hidden", () => {
    document.body.innerHTML = `
      <div id="rail" style="overflow-x: auto"><b id="next" data-pilot="Next slide"></b></div>
      <b id="ghost" data-pilot="Ghost" style="opacity: 0"></b>`;
    at(byId("rail"), 0, 0, 300, 100);
    at(byId("next"), 400, 0, 300, 100);
    at(byId("ghost"), 0, 200, 100, 20);
    hits = (x, y) => [x >= 400 ? byId("next") : byId("ghost")].filter(() => y >= 0);
    expect(locateSeen().map((e) => [e.key, e.sighting])).toEqual([
      ["Next slide", "hidden"],
      ["Ghost", "hidden"],
    ]);
  });

  test("stops at the prompt's own cap when it is below the scan's", () => {
    document.body.innerHTML = `<b data-pilot="A"></b><b data-pilot="B"></b><b data-pilot="C"></b>`;
    expect(locateSeen({ embedded: 2 }).map((e) => e.key)).toEqual(["A", "B"]);
  });

  test("leaves the item tier out while the model can't pull it", () => {
    document.body.innerHTML = `<b data-pilot="Nav"></b><i data-pilot-item="Card"></i>`;
    expect(locateSeen({ items: false }).map((e) => e.key)).toEqual(["Nav"]);
    expect(locateSeen().map((e) => e.key)).toEqual(["Nav", "Card"]);
  });
});

describe("showSeen", () => {
  test("outlines visible elements in place, hatches hidden ones, and restores the page on hide", () => {
    document.body.innerHTML = `
      <div id="m" style="position: absolute"></div>
      <button id="a" data-pilot="Save" style="outline: 1px solid green"></button>
      <button id="b" data-pilot="Behind"></button><i id="c" data-pilot-item="Card"></i>`;
    at(byId("m"), 500, 0, 524, 768);
    at(byId("a"), 100, 100, 200, 40);
    at(byId("b"), 600, 100, 200, 40);
    at(byId("c"), 100, 300, 200, 40);
    hits = (x, y) => [x >= 500 ? byId("m") : y >= 300 ? byId("c") : byId("a")];
    const hide = showSeen();
    expect(byId("a").style.getPropertyValue("outline-style")).toBe("solid");
    expect(byId("c").style.getPropertyValue("outline-style")).toBe("dashed");
    expect(byId("b").style.getPropertyValue("outline-style")).toBe("");
    expect(document.querySelector("[data-sitepilot-seen]")!.children).toHaveLength(1);
    hide();
    expect(document.querySelector("[data-sitepilot-seen]")).toBeNull();
    expect(byId("a").style.getPropertyValue("outline-color")).toBe("green");
    expect(byId("a").style.getPropertyValue("outline-width")).toBe("1px");
    expect(byId("c").style.getPropertyValue("outline-style")).toBe("");
  });

  test("a second view replaces the first, and the page is restored whichever is hidden first", () => {
    document.body.innerHTML = `<button id="a" data-pilot="Save" style="color: red"></button>`;
    at(byId("a"), 100, 100, 200, 40);
    hits = () => [byId("a")];
    const first = showSeen();
    const second = showSeen();
    expect(document.querySelectorAll("[data-sitepilot-seen]")).toHaveLength(1);
    first();
    expect(byId("a").style.getPropertyValue("outline-style")).toBe("solid");
    second();
    expect(byId("a").style.getPropertyValue("outline-style")).toBe("");
    expect(byId("a").style.getPropertyValue("color")).toBe("red");
  });

  test("redraws when the page changes an outlined element's inline style", async () => {
    document.body.innerHTML = `<button id="a" data-pilot="Save"></button>`;
    at(byId("a"), 100, 100, 200, 40);
    hits = () => [byId("a")];
    const hide = showSeen();
    expect(byId("a").style.getPropertyValue("outline-style")).toBe("solid");
    at(byId("a"), 100, 5000, 200, 40);
    byId("a").style.setProperty("transform", "translateY(4900px)");
    await new Promise((r) => setTimeout(r, 150));
    expect(byId("a").style.getPropertyValue("outline-style")).toBe("");
    hide();
  });
});
