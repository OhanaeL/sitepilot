import { beforeEach, describe, expect, test } from "bun:test";
import { createPilot } from "../src/pilot";
import type { CompletionReply, CompletionRequest, Transport } from "../src/transport";

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

const call = (name: string, args: Record<string, unknown>, id = "c1") => ({
  toolCalls: [{ id, name, args }],
  wireToolCalls: [{ id, type: "function" as const, function: { name, arguments: JSON.stringify(args) } }],
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("createPilot", () => {
  test("plain answer: one round, screen embedded in the system prompt", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([{ content: "Hi there" }]);
    const pilot = createPilot({ transport, getPath: () => "/x" });
    await pilot.send("hello");
    expect(transport.requests).toHaveLength(1);
    const [system, user] = transport.requests[0]!.messages;
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("route /x");
    expect(system?.content).toContain("- Save button");
    expect(user).toEqual({ role: "user", content: "hello" });
    expect(pilot.getState().messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "hello"],
      ["assistant", "Hi there"],
    ]);
    expect(pilot.getState().status).toBe("idle");
  });

  test("click tool executes against the DOM and feeds the result back", async () => {
    let clicked = 0;
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    document.querySelector("button")!.addEventListener("click", () => clicked++);
    const transport = scripted([call("click_element", { target: "Save button" }), { content: "Done." }]);
    const pilot = createPilot({ transport });
    await pilot.send("save it");
    expect(clicked).toBe(1);
    const second = transport.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
    expect(second.at(-1)).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
      content: expect.stringContaining("Done: clicked"),
    });
    expect(pilot.getState().messages.some((m) => m.role === "activity" && m.content === "Clicked Save button")).toBe(
      true,
    );
  });

  test("fill updates a controlled-style input and dispatches input", async () => {
    document.body.innerHTML = `<input data-pilot="Name field">`;
    const input = document.querySelector("input")!;
    let seen = "";
    input.addEventListener("input", () => (seen = input.value));
    const transport = scripted([call("fill_field", { target: "Name field", text: "Ada" }), { content: "ok" }]);
    await createPilot({ transport }).send("type Ada");
    expect(seen).toBe("Ada");
  });

  test("disabled tools are refused even if the model calls them", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([call("click_element", { target: "Save button" }), { content: "ok" }]);
    await createPilot({ transport, tools: ["highlight_element"] }).send("click");
    expect(transport.requests[0]!.tools?.map((t) => t.function.name)).toEqual([
      "highlight_element",
      "get_screen_elements",
    ]);
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("not enabled"),
    });
  });

  test("no tools enabled: no tools on the wire, look-closer refused", async () => {
    const transport = scripted([call("get_screen_elements", {}), { content: "ok" }]);
    await createPilot({ transport, tools: [] }).send("look");
    expect(transport.requests[0]!.tools).toEqual([]);
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("cannot be read"),
    });
  });

  test("get_screen_elements returns the item tier", async () => {
    document.body.innerHTML = `<li data-pilot-item="Project card: Acme"></li>`;
    const transport = scripted([call("get_screen_elements", {}), { content: "ok" }]);
    await createPilot({ transport }).send("which projects?");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "- Project card: Acme: Project card: Acme",
    });
  });

  test("missing target reports failure instead of throwing", async () => {
    const transport = scripted([call("click_element", { target: "Ghost" }), { content: "ok" }]);
    const pilot = createPilot({ transport });
    await pilot.send("click ghost");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("isn't on this screen"),
    });
    expect(pilot.getState().error).toBeNull();
  });

  test("round cap stops a looping model", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted(
      Array.from({ length: 5 }, (_, i) => call("click_element", { target: "Save button" }, `c${i}`)),
    );
    const pilot = createPilot({ transport, maxRounds: 2 });
    await pilot.send("loop");
    expect(transport.requests).toHaveLength(2);
    expect(pilot.getState().messages.at(-1)?.content).toBe("Stopped after 2 steps");
  });

  test("transport error lands in state.error and the pilot recovers", async () => {
    const transport: Transport = {
      complete: async () => {
        throw new Error("boom");
      },
    };
    const pilot = createPilot({ transport });
    await pilot.send("x");
    expect(pilot.getState().error).toBe("boom");
    expect(pilot.getState().status).toBe("idle");
  });

  test("a send while busy is queued and flushed afterwards", async () => {
    const transport = scripted([{ content: "one" }, { content: "two" }]);
    const pilot = createPilot({ transport });
    const first = pilot.send("a");
    await pilot.send("b");
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(pilot.getState().messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual([
      "one",
      "two",
    ]);
  });

  test("history is trimmed at a user boundary", async () => {
    const transport = scripted([{ content: "1" }, { content: "2" }, { content: "3" }]);
    const pilot = createPilot({ transport, maxHistory: 3 });
    await pilot.send("a");
    await pilot.send("b");
    await pilot.send("c");
    const last = transport.requests[2]!.messages.slice(1);
    expect(last[0]).toEqual({ role: "user", content: "b" });
    expect(last).toHaveLength(3);
  });
});

describe("plugins", () => {
  const plugin = {
    name: "cam",
    brief: "CAM BRIEF",
    tools: [
      {
        kind: "action" as const,
        spec: { type: "function" as const, function: { name: "snap", description: "snap", parameters: { type: "object", properties: {} } } },
        execute: async () => ({
          content: "snapped",
          attachments: [{ type: "image_url" as const, image_url: { url: "data:image/png;base64,AAAA" } }],
        }),
      },
    ],
  };

  test("plugin tools are advertised by default and their brief joins the system prompt", async () => {
    const transport = scripted([{ content: "ok" }]);
    await createPilot({ transport, plugins: [plugin] }).send("hi");
    const req = transport.requests[0]!;
    expect(req.tools?.map((t) => t.function.name)).toContain("snap");
    expect(req.messages[0]?.content).toContain("CAM BRIEF");
  });

  test("attachments ride as a follow-up user message and are stripped on the next turn", async () => {
    const transport = scripted([call("snap", {}), { content: "seen" }, { content: "later" }]);
    const pilot = createPilot({ transport, plugins: [plugin] });
    await pilot.send("look");
    const second = transport.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({ role: "tool", content: "snapped" });
    expect(second.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
    });

    await pilot.send("again");
    const third = transport.requests[2]!.messages;
    const media = third.filter((m) => m.role === "user" && typeof m.content !== "string");
    expect(media).toHaveLength(0);
    expect(third.some((m) => typeof m.content === "string" && m.content.includes("screenshot omitted"))).toBe(true);
  });

  test("an explicit consent list can exclude a plugin action", async () => {
    const transport = scripted([{ content: "ok" }]);
    await createPilot({ transport, plugins: [plugin], tools: ["click_element"] }).send("hi");
    expect(transport.requests[0]!.tools?.map((t) => t.function.name)).toEqual(["click_element", "get_screen_elements"]);
  });

  test("a throwing tool becomes a tool result, not a pilot error", async () => {
    const bad = { name: "bad", tools: [{ ...plugin.tools[0]!, execute: async () => { throw new Error("lens cap"); } }] };
    const transport = scripted([call("snap", {}), { content: "ok" }]);
    const pilot = createPilot({ transport, plugins: [bad] });
    await pilot.send("look");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("lens cap") });
    expect(pilot.getState().error).toBeNull();
  });
});
