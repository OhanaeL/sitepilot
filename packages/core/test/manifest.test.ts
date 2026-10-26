import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolveKey, scanAll, scanAmbient, scanContext, scanItems } from "../src/dom";
import { beginAgentAction, clearEvents, getEvents, installEventsBuffer, resetEventCapture } from "../src/events";
import { loadManifest, renderLabel, setManifest } from "../src/manifest";
import { createPilot } from "../src/pilot";
import type { CompletionReply, CompletionRequest, Transport } from "../src/transport";

const manifest = {
  elements: [
    { selector: ".btn-new", label: "Create project button", hint: "Opens the dialog." },
    { selector: ".card", label: "Project card: {text:.title}", tier: "item" as const, hint: "Click opens details." },
    { selector: "nav a", label: "{text} nav link" },
    { selector: "#search", label: "Search field", read: false },
    { selector: "((bad", label: "never" },
  ],
  areas: [{ selector: "main.projects", topic: "projects", description: "The projects list." }],
  hints: { "Search field": "Filters live." },
  systemPrompt: "FROM MANIFEST",
};

beforeEach(() => {
  document.body.innerHTML = "";
  setManifest(manifest);
});
afterEach(() => setManifest(null));

describe("renderLabel", () => {
  test("fills placeholders and collapses whitespace", () => {
    document.body.innerHTML = `<a href="/x" title="T" data-id="42">  Go   <b class="t">deep</b></a>`;
    const a = document.querySelector("a")!;
    expect(renderLabel("{text} ({href}) [{attr:data-id}] <{text:.t}> {title} {nope}", a)).toBe(
      "Go deep (/x) [42] <deep> T",
    );
  });
});

describe("manifest-driven scanning", () => {
  test("class-matched elements need no attributes; templates fill per element", () => {
    document.body.innerHTML = `
      <nav><a href="/">Home</a><a href="/settings">Settings</a></nav>
      <input id="search" value="acme">
      <main class="projects">
        <button class="btn-new"></button>
        <div class="card"><span class="title">Apollo</span></div>
        <div class="card"><span class="title">Borealis</span></div>
      </main>`;
    expect(scanAmbient().map((e) => [e.key, e.description, e.hint])).toEqual([
      ["Home nav link", "Home nav link", undefined],
      ["Settings nav link", "Settings nav link", undefined],
      ["Search field", "Search field: “acme”", undefined],
      ["Create project button", "Create project button", "Opens the dialog."],
    ]);
    expect(scanItems().map((e) => [e.key, e.hint])).toEqual([
      ["Project card: Apollo", "Click opens details."],
      ["Project card: Borealis", "Click opens details."],
    ]);
    expect(scanContext()).toEqual({ topic: "projects", description: "The projects list." });
  });

  test("attribute label beats the manifest template; manifest hint fills in", () => {
    document.body.innerHTML = `<button class="btn-new" data-pilot="New thing button"></button>`;
    expect(scanAll().map((e) => [e.key, e.hint])).toEqual([["New thing button", "Opens the dialog."]]);
  });

  test("DOM order and one namespace hold across sources", () => {
    document.body.innerHTML = `<b data-pilot="Card"></b><div class="card"><i class="title">Card</i></div><b data-pilot="Z"></b>`;
    expect(scanAll().map((e) => e.key)).toEqual(["Card", "Project card: Card", "Z"]);
  });

  test("resolveKey finds manifest elements and ignores broken selectors", () => {
    document.body.innerHTML = `<div class="card"><span class="title">Apollo</span></div>`;
    expect(resolveKey("Project card: Apollo")?.className).toBe("card");
    expect(resolveKey("never")).toBeNull();
  });

  test("the events buffer records clicks on manifest-matched elements", () => {
    installEventsBuffer();
    clearEvents();
    document.body.innerHTML = `<div class="card"><span class="title">Apollo</span></div>`;
    document.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getEvents()[0]).toMatchObject({ type: "click", key: "Project card: Apollo", tier: "item" });
  });

  test("resetEventCapture clears a pending agent-action window so capture resumes", () => {
    installEventsBuffer();
    beginAgentAction();
    resetEventCapture();
    document.body.innerHTML = `<div class="card"><span class="title">Apollo</span></div>`;
    document.querySelector("span")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(getEvents()[0]).toMatchObject({ type: "click", key: "Project card: Apollo", tier: "item" });
  });
});

function scripted(replies: Array<Partial<CompletionReply>>): Transport & { requests: CompletionRequest[] } {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    async complete(req) {
      requests.push(req);
      return { content: "", toolCalls: [], wireToolCalls: [], ...(replies.shift() ?? {}) };
    },
  };
}

describe("pilot manifest option", () => {
  test("loads from a URL, applies systemPrompt and hints, and send waits for it", async () => {
    setManifest(null);
    document.body.innerHTML = `<input id="search">`;
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string) => {
      fetched.push(String(url));
      return new Response(JSON.stringify(manifest), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const transport = scripted([{ content: "ok" }]);
    const pilot = createPilot({ transport, manifest: "/pilot.json", getPath: () => "/" });
    await pilot.send("hi");
    expect(fetched).toEqual(["/pilot.json"]);
    const sys = transport.requests[0]!.messages[0]!.content as string;
    expect(sys).toMatch(/^FROM MANIFEST/);
    expect(sys).toContain("- Search field: Search field — Filters live.");
  });

  test("explicit systemPrompt and hints layer over the manifest's", async () => {
    document.body.innerHTML = `<input id="search"><button class="btn-new"></button>`;
    const transport = scripted([{ content: "ok" }]);
    await createPilot({
      transport,
      manifest,
      systemPrompt: "MINE",
      hints: { "Create project button": "Pro only." },
    }).send("hi");
    const sys = transport.requests[0]!.messages[0]!.content as string;
    expect(sys).toMatch(/^MINE/);
    expect(sys).toContain("Search field — Filters live.");
    expect(sys).toContain("Create project button — Opens the dialog. Pro only.");
  });

  test("a failing manifest URL surfaces as state.error but does not block sends", async () => {
    setManifest(null);
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    const transport = scripted([{ content: "ok" }]);
    const pilot = createPilot({ transport, manifest: "/missing.json" });
    await pilot.send("hi");
    expect(pilot.getState().error).toContain("manifest");
    expect(transport.requests).toHaveLength(1);
  });

  test("loadManifest passes objects through", async () => {
    expect(await loadManifest(manifest)).toBe(manifest);
  });
});
