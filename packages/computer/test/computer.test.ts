import { beforeEach, describe, expect, test } from "bun:test";
import { createPilot, type CompletionReply, type CompletionRequest, type Transport } from "@sitepilot/core";
import { computerPlugin, parseBatch, elementAt, frameElements, toNormRect, type Outcome } from "../src";

function scripted(replies: Array<Partial<CompletionReply>>): Transport & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      const next = replies.shift() ?? {};
      return { content: "", toolCalls: [], wireToolCalls: [], ...next };
    },
  };
}

const computer = (args: Record<string, unknown>, id = "c1") => ({
  toolCalls: [{ id, name: "computer", args }],
  wireToolCalls: [{ id, type: "function" as const, function: { name: "computer", arguments: JSON.stringify(args) } }],
});

const box = (left: number, top: number, w: number, h: number) => ({
  x: left,
  y: top,
  left,
  top,
  width: w,
  height: h,
  right: left + w,
  bottom: top + h,
  toJSON: () => ({}),
});

function place(el: Element, left: number, top: number, w: number, h: number): void {
  (el as HTMLElement).getBoundingClientRect = () => box(left, top, w, h) as DOMRect;
}

const fakeRender = async () => "data:image/png;base64,FRAME";
const vp = { w: 1000, h: 500 };

beforeEach(() => {
  document.body.innerHTML = "";
  Object.assign(window, { innerWidth: 1000, innerHeight: 500 });
});

describe("parseBatch", () => {
  test("empty and missing actions are an observation", () => {
    expect(parseBatch({})).toEqual({ actions: [] });
    expect(parseBatch({ actions: [] })).toEqual({ actions: [] });
  });

  test("validates each action's fields", () => {
    expect(
      parseBatch({
        actions: [
          { do: "click", x: 1, y: 2 },
          { do: "type", text: "a" },
          { do: "scroll", dy: -3 },
          { do: "wait", ms: 10 },
        ],
      }).actions,
    ).toHaveLength(4);
    expect(() => parseBatch({ actions: [{ do: "click", x: 1 }] })).toThrow("click needs");
    expect(() => parseBatch({ actions: [{ do: "click", x: 1000, y: 0 }] })).toThrow();
    expect(() => parseBatch({ actions: [{ do: "wait", ms: 5000 }] })).toThrow("wait needs");
    expect(() => parseBatch({ actions: [{ do: "fly" }] })).toThrow("unknown do");
    expect(() => parseBatch({ actions: Array(9).fill({ do: "wait", ms: 1 }) })).toThrow("at most 8");
  });
});

describe("frame geometry", () => {
  test("rects normalize to 0..999 and off-screen elements are dropped", () => {
    document.body.innerHTML = `<b id="a" data-pilot="A"></b><b id="b" data-pilot="B"></b>`;
    place(document.getElementById("a")!, 100, 50, 200, 100);
    place(document.getElementById("b")!, 2000, 50, 10, 10);
    const els = frameElements(vp);
    expect(els.map((e) => e.key)).toEqual(["A"]);
    expect(els[0]!.rect).toEqual({ x: 100, y: 100, w: 200, h: 200 });
    expect(toNormRect(box(0, 0, 1000, 500) as DOMRect, vp)).toEqual({ x: 0, y: 0, w: 999, h: 999 });
  });

  test("elementAt picks the innermost opted-in box, or null on blank space", () => {
    document.body.innerHTML = `<div id="card" data-pilot-item="Card"><button id="btn" data-pilot="Open"></button></div>`;
    place(document.getElementById("card")!, 0, 0, 500, 500);
    place(document.getElementById("btn")!, 100, 100, 100, 50);
    expect(elementAt(150, 250, vp)?.key).toBe("Open");
    expect(elementAt(400, 800, vp)?.key).toBe("Card");
    expect(elementAt(900, 900, vp)).toBeNull();
  });

  test("elementAt picks the topmost box when unrelated opted-in boxes overlap", () => {
    document.body.innerHTML = `<div id="card" data-pilot-item="Card"></div><div id="menu" data-pilot="Delete option"></div>`;
    const card = document.getElementById("card")!;
    const menu = document.getElementById("menu")!;
    place(card, 0, 0, 500, 500);
    place(menu, 100, 100, 200, 50);
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => [menu, card, document.body];
    try {
      expect(elementAt(200, 250, vp)?.key).toBe("Delete option");
    } finally {
      document.elementsFromPoint = original;
    }
  });
});

describe("computer tool through the pilot", () => {
  const plugins = [computerPlugin({ renderFrame: fakeRender })];

  const lastOutcome = (t: ReturnType<typeof scripted>): Outcome =>
    JSON.parse((t.requests.at(-1)!.messages.findLast((m) => m.role === "tool") as { content: string }).content);

  test("empty batch observes: outcome + attached frame + brief in prompt", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    place(document.querySelector("button")!, 10, 10, 100, 20);
    const transport = scripted([computer({ actions: [] }), { content: "I see a Save button" }]);
    await createPilot({ transport, plugins }).send("what do you see?");
    expect(transport.requests[0]!.messages[0]!.content).toContain("THE FRAME IS NOT THE WHOLE PAGE");
    const outcome = lastOutcome(transport);
    expect(outcome).toMatchObject({
      executed: 0,
      requested: 0,
      failed: null,
      screenshot: "attached",
      screen: { w: 1000, h: 500 },
    });
    expect(outcome.elements).toEqual([{ key: "Save button", x: 10, y: 20, w: 100, h: 40 }]);
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image_url", image_url: { url: "data:image/png;base64,FRAME" } }],
    });
  });

  test("click by coordinate lands on the opted-in element and type goes into the focused field", async () => {
    document.body.innerHTML = `<input id="f" data-pilot="Search field"><button id="b" data-pilot="Go"></button>`;
    const field = document.getElementById("f") as HTMLInputElement;
    place(field, 0, 0, 500, 50);
    place(document.getElementById("b")!, 600, 0, 100, 50);
    let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    const transport = scripted([
      computer({
        actions: [
          { do: "click", x: 250, y: 50 },
          { do: "type", text: "acme" },
          { do: "click", x: 650, y: 50 },
          { do: "wait", ms: 1 },
        ],
      }),
      { content: "done" },
    ]);
    await createPilot({ transport, plugins }).send("search acme");
    expect(field.value).toBe("acme");
    expect(clicks).toBe(1);
    expect(lastOutcome(transport)).toMatchObject({ executed: 4, requested: 4, failed: null });
  });

  test("a click on blank space fails and stops the batch, reporting executed vs requested", async () => {
    document.body.innerHTML = `<button data-pilot="Only"></button>`;
    place(document.querySelector("button")!, 0, 0, 10, 10);
    const transport = scripted([
      computer({
        actions: [
          { do: "wait", ms: 1 },
          { do: "click", x: 900, y: 900 },
          { do: "wait", ms: 1 },
        ],
      }),
      { content: "hm" },
    ]);
    await createPilot({ transport, plugins }).send("click somewhere");
    expect(lastOutcome(transport)).toMatchObject({
      executed: 1,
      requested: 3,
      failed: { index: 1, do: "click", why: expect.stringContaining("no opted-in element") },
    });
  });

  test("a batch stopped mid-way runs none of its remaining actions", async () => {
    document.body.innerHTML = `<button id="b" data-pilot="Go"></button>`;
    place(document.getElementById("b")!, 600, 0, 100, 50);
    let clicks = 0;
    document.getElementById("b")!.addEventListener("click", () => clicks++);
    const transport = scripted([
      computer({
        actions: [
          { do: "wait", ms: 100 },
          { do: "click", x: 650, y: 50 },
        ],
      }),
    ]);
    const pilot = createPilot({ transport, plugins });
    const sent = pilot.send("go");
    await new Promise((r) => setTimeout(r, 20));
    pilot.stop();
    await sent;
    await new Promise((r) => setTimeout(r, 150));
    expect(clicks).toBe(0);
  });

  test("type works in a field opted in by the manifest", async () => {
    document.body.innerHTML = `<input id="q">`;
    const field = document.getElementById("q") as HTMLInputElement;
    place(field, 0, 0, 500, 50);
    const transport = scripted([
      computer({
        actions: [
          { do: "click", x: 250, y: 50 },
          { do: "type", text: "acme" },
        ],
      }),
      { content: "done" },
    ]);
    const manifest = { elements: [{ selector: "#q", label: "Search field" }] };
    await createPilot({ transport, plugins, manifest }).send("search acme");
    expect(lastOutcome(transport)).toMatchObject({ executed: 2, failed: null });
    expect(field.value).toBe("acme");
  });

  test("type with nothing focused fails", async () => {
    const transport = scripted([computer({ actions: [{ do: "type", text: "x" }] }), { content: "hm" }]);
    await createPilot({ transport, plugins }).send("type");
    expect(lastOutcome(transport).failed?.why).toContain("no opted-in text field is focused");
  });

  test("malformed batch is rejected as a tool result with the cheat sheet", async () => {
    const transport = scripted([computer({ actions: [{ do: "click" }] }), { content: "ok" }]);
    await createPilot({ transport, plugins }).send("x");
    const result = transport.requests[1]!.messages.findLast((m) => m.role === "tool") as { content: string };
    expect(result.content).toContain("NOTHING ran");
    expect(result.content).toContain("click needs");
  });

  test("renderer returning null marks the screenshot unavailable and attaches nothing", async () => {
    const transport = scripted([computer({}), { content: "ok" }]);
    await createPilot({ transport, plugins: [computerPlugin({ renderFrame: async () => null })] }).send("look");
    expect(lastOutcome(transport).screenshot).toBe("unavailable");
    expect(transport.requests[1]!.messages.at(-1)!.role).toBe("tool");
  });
});
