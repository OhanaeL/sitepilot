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

  test("tags replies and their tool activity with the model of that round, never the user's turn", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([
      { ...call("click_element", { target: "Save button" }), model: "jev" },
      { content: "Saved.", model: "gemini-3.7-flash" },
    ]);
    const pilot = createPilot({ transport });
    await pilot.send("save it");
    expect(pilot.getState().messages.map((m) => [m.role, m.by])).toEqual([
      ["user", undefined],
      ["activity", "jev"],
      ["assistant", "gemini-3.7-flash"],
    ]);
  });

  test("a stopped run finishing late leaves the run that replaced it alone", async () => {
    const pending: Array<(r: CompletionReply) => void> = [];
    const transport: Transport = {
      complete: () => new Promise((resolve) => pending.push(resolve)),
    };
    const pilot = createPilot({ transport });
    const first = pilot.send("one");
    await Promise.resolve();
    pilot.stop();
    const second = pilot.send("two");
    await new Promise((r) => setTimeout(r, 0));
    pending[0]!({ content: "late", toolCalls: [], wireToolCalls: [] });
    await first;
    expect(pilot.getState().status).toBe("thinking");
    pilot.stop();
    pending[1]!({ content: "too late", toolCalls: [], wireToolCalls: [] });
    await second;
    expect(pilot.getState().messages.map((m) => m.content)).toEqual(["one", "two"]);
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
    await createPilot({ transport, enabledTools: ["highlight_element"] }).send("click");
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
    await createPilot({ transport, enabledTools: [] }).send("look");
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
    expect(
      pilot
        .getState()
        .messages.filter((m) => m.role === "assistant")
        .map((m) => m.content),
    ).toEqual(["one", "two"]);
  });

  test("history is trimmed at a user boundary", async () => {
    const transport = scripted([{ content: "1" }, { content: "2" }, { content: "3" }]);
    const pilot = createPilot({ transport, history: { max: 3 } });
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
        spec: {
          type: "function" as const,
          function: { name: "snap", description: "snap", parameters: { type: "object", properties: {} } },
        },
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
    await createPilot({ transport, plugins: [plugin], enabledTools: ["click_element"] }).send("hi");
    expect(transport.requests[0]!.tools?.map((t) => t.function.name)).toEqual(["click_element", "get_screen_elements"]);
  });

  test("a throwing tool becomes a tool result, not a pilot error", async () => {
    const bad = {
      name: "bad",
      tools: [
        {
          ...plugin.tools[0]!,
          execute: async () => {
            throw new Error("lens cap");
          },
        },
      ],
    };
    const transport = scripted([call("snap", {}), { content: "ok" }]);
    const pilot = createPilot({ transport, plugins: [bad] });
    await pilot.send("look");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("lens cap"),
    });
    expect(pilot.getState().error).toBeNull();
  });
});

describe("customization", () => {
  test("defineTool adds a first-class custom tool with typed args", async () => {
    const { defineTool } = await import("../src/tools");
    const seen: string[] = [];
    const count = defineTool<{ status: string }>({
      name: "count_projects",
      description: "How many projects have the given status.",
      parameters: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
      execute: ({ status }) => {
        seen.push(status);
        return `3 projects are ${status}`;
      },
    });
    const transport = scripted([call("count_projects", { status: "active" }), { content: "three" }]);
    await createPilot({ transport, tools: [count] }).send("how many active?");
    expect(seen).toEqual(["active"]);
    expect(transport.requests[0]!.tools?.map((t) => t.function.name)).toContain("count_projects");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", content: "3 projects are active" });
  });

  test("builtinTools can drop or patch built-ins", async () => {
    const transport = scripted([{ content: "ok" }]);
    await createPilot({
      transport,
      builtinTools: { click_element: false, highlight_element: { description: "POINT AT IT" } },
    }).send("hi");
    const specs = transport.requests[0]!.tools!;
    expect(specs.map((t) => t.function.name)).toEqual(["highlight_element", "fill_field", "get_screen_elements"]);
    expect(specs[0]!.function.description).toBe("POINT AT IT");
  });

  test("builtinTools: false leaves only custom/plugin tools", async () => {
    const transport = scripted([{ content: "ok" }]);
    const pilot = createPilot({ transport, builtinTools: false });
    await pilot.send("hi");
    expect(pilot.availableTools()).toHaveLength(0);
    expect(transport.requests[0]!.tools).toEqual([]);
  });

  test("strings override model-facing results, transcript lines and the synthetic turn", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([call("click_element", { target: "Save button" }), { content: "ok" }]);
    const pilot = createPilot({
      transport,
      strings: { clicked: (k) => `OK:${k}`, activity: { clicked: (k) => `did ${k}` } },
    });
    await pilot.send("click");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({ role: "tool", content: "OK:Save button" });
    expect(pilot.getState().messages.some((m) => m.content === "did Save button")).toBe(true);
    expect(pilot.strings.userClicked("X")).toBe('I clicked "X".');
  });

  test("user and context land in the prompt; user.id rides as userId", async () => {
    const transport = scripted([{ content: "ok" }]);
    let plan = "free";
    await createPilot({
      transport,
      systemPrompt: "BASE",
      user: { id: "u1", name: "Ada", role: "admin" },
      context: () => `Plan: ${plan}`,
    }).send("hi");
    const req = transport.requests[0]!;
    const sys = req.messages[0]!.content as string;
    expect(sys).toMatch(/^BASE\n\nCURRENT SCREEN/);
    expect(sys).toContain("ABOUT THE USER:\n- id: u1\n- name: Ada\n- role: admin");
    expect(sys).toContain("Plan: free");
    expect(req.userId).toBe("u1");
    plan = "pro";
  });

  test("promptOptions.renderScreen replaces the screen block", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([{ content: "ok" }]);
    await createPilot({ transport, promptOptions: { renderScreen: (s) => `ELEMENTS=${s.ambient.length}` } }).send("hi");
    expect(transport.requests[0]!.messages[0]!.content).toContain("ELEMENTS=1");
    expect(transport.requests[0]!.messages[0]!.content).not.toContain("CURRENT SCREEN (route");
  });

  test("prompt: server sends no system message and a structured context instead", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button>`;
    const transport = scripted([{ content: "ok" }]);
    await createPilot({
      transport,
      prompt: "server",
      user: { id: "u1" },
      context: "Plan: pro",
      plugins: [{ name: "p", brief: "BRIEF" }],
      getPath: () => "/x",
    }).send("hi");
    const req = transport.requests[0]!;
    expect(req.messages[0]).toEqual({ role: "user", content: "hi" });
    expect(req.context).toMatchObject({
      screen: { path: "/x", ambient: [{ key: "Save button" }] },
      user: { id: "u1" },
      extra: "Plan: pro",
      briefs: ["BRIEF"],
      enabledTools: ["highlight_element", "click_element", "fill_field"],
    });
  });

  test("history: initial restores the transcript, onChange reports every write, get/load round-trip", async () => {
    const changes: number[] = [];
    const transport = scripted([{ content: "two" }]);
    const pilot = createPilot({
      transport,
      history: {
        initial: [
          { role: "user", content: "one?" },
          { role: "assistant", content: "one." },
        ],
        onChange: (h) => changes.push(h.length),
      },
    });
    expect(pilot.getState().messages.map((m) => m.content)).toEqual(["one?", "one."]);
    await pilot.send("two?");
    expect(changes).toEqual([3, 4]);
    expect(transport.requests[0]!.messages.slice(1)).toHaveLength(3);
    const saved = pilot.getHistory();
    expect(saved).toHaveLength(4);
    expect((saved[3] as { ephemeral?: boolean }).ephemeral).toBeUndefined();

    const other = createPilot({ transport: scripted([]) });
    other.loadHistory(saved);
    expect(other.getState().messages.map((m) => m.content)).toEqual(["one?", "one.", "two?", "two"]);
  });

  test("history.trim replaces the default trimmer", async () => {
    const transport = scripted([{ content: "a" }, { content: "b" }]);
    const pilot = createPilot({ transport, history: { trim: (h) => h.slice(-1) } });
    await pilot.send("1");
    await pilot.send("2");
    expect(transport.requests[1]!.messages.slice(1)).toEqual([{ role: "user", content: "2" }]);
  });
});

describe("hints option", () => {
  test("client-side hints reach the prompt and get_screen_elements", async () => {
    document.body.innerHTML = `<button data-pilot="Save button"></button><li data-pilot-item="Card" data-pilot-hint="own hint"></li>`;
    const transport = scripted([call("get_screen_elements", {}), { content: "ok" }]);
    await createPilot({ transport, hints: { "Save button": "server-ish hint", Card: "map hint" } }).send("look");
    expect(transport.requests[0]!.messages[0]!.content).toContain("- Save button: Save button — server-ish hint");
    expect(transport.requests[1]!.messages.at(-1)).toMatchObject({
      role: "tool",
      content: "- Card: Card — own hint map hint",
    });
  });
});
