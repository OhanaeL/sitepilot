import { describe, expect, test } from "bun:test";
import { createPilotHandler, jevRouter, type JevAnswer, type JevRouteEvent } from "../src";

type Body = Record<string, unknown>;

function stack(answers: Record<string, JevAnswer> | Response) {
  const jev: Body[] = [];
  const jevHeaders: Headers[] = [];
  const llm: Body[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    if (String(url).includes("/v1/systemone")) {
      jev.push(body);
      jevHeaders.push(new Headers(init?.headers));
      if (answers instanceof Response) return answers;
      return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    llm.push(body);
    return Response.json({ choices: [{ message: { content: "from the llm" } }] });
  }) as unknown as typeof fetch;
  return { jev, jevHeaders, llm, fetch };
}

const noul = (p: number): JevAnswer => ({ type: "noul", noul: p });
const choice = (pick: string, p: number, other = "other"): JevAnswer => ({
  type: "choice",
  choice: pick,
  confidence: p,
  probabilities: { [pick]: p, [other]: 1 - p },
});

const target = { type: "string", description: "Key of the on-screen element." };
const tools = [
  {
    type: "function",
    function: {
      name: "highlight_element",
      description: "Spotlight one element.",
      parameters: { type: "object", properties: { target, message: { type: "string" } }, required: ["target"] },
    },
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click one element.",
      parameters: { type: "object", properties: { target }, required: ["target"] },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_field",
      description: "Type text.",
      parameters: { type: "object", properties: { target, text: { type: "string" } }, required: ["target", "text"] },
    },
  },
];
const sitepilot = {
  screen: {
    path: "/",
    ambient: [
      { key: "Settings nav link", description: "Settings nav link", tier: "ambient" },
      {
        key: "Create project button",
        description: "Create project button",
        tier: "ambient",
        hint: "Opens the dialog.",
      },
    ],
    events: [],
    area: null,
  },
  user: null,
  extra: "Plan: free",
  briefs: [],
  enabledTools: ["highlight_element", "click_element", "fill_field"],
};

const post = (messages: Body[], extra: Body = {}) =>
  new Request("http://x/api/pilot", { method: "POST", body: JSON.stringify({ messages, tools, sitepilot, ...extra }) });

const jevCall = (id: string, name: string, args: Body) => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

function handlerFor(s: ReturnType<typeof stack>, events: JevRouteEvent[] = [], opts: Body = {}) {
  return createPilotHandler({
    apiKey: "sk",
    model: "gpt-x",
    fetch: s.fetch,
    prompt: { hints: { "Settings nav link": "Account settings live here." } },
    router: jevRouter({ apiKey: "ts", fetch: s.fetch, onRoute: (e) => events.push(e), ...opts }),
  });
}

describe("jevRouter", () => {
  test("runs a plain on-screen action itself and never calls the LLM", async () => {
    const s = stack({
      self: noul(0.92),
      tool: choice("highlight_element", 1),
      target: choice("Settings nav link", 0.98),
    });
    const events: JevRouteEvent[] = [];
    const res = await handlerFor(s, events)(post([{ role: "user", content: "where are the settings?" }]));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      model: string;
      choices: Array<{
        finish_reason: string;
        message: { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
      }>;
    };
    const call = json.choices[0]!.message.tool_calls[0]!;
    expect(json.model).toBe("jev-1.14.0");
    expect(json.choices[0]!.finish_reason).toBe("tool_calls");
    expect(call.id.startsWith("jev_")).toBe(true);
    expect(call.function.name).toBe("highlight_element");
    expect(JSON.parse(call.function.arguments)).toEqual({ target: "Settings nav link" });
    expect(s.llm).toHaveLength(0);
    expect(events.map((e) => e.reason)).toEqual(["act"]);

    const asked = s.jev[0]!;
    const state = asked["state"] as Body;
    expect(Object.keys(state["actions"] as Body)).toEqual(["highlight_element", "click_element"]);
    expect(state["app_facts"]).toBe("Plan: free");
    expect((state["screen"] as { elements: Body[] }).elements).toEqual([
      { key: "Settings nav link", description: "Settings nav link", hint: "Account settings live here." },
      { key: "Create project button", description: "Create project button", hint: "Opens the dialog." },
    ]);
    expect(Object.keys(asked["questions"] as Body).sort()).toEqual(["self", "target", "tool"]);
  });

  test("hands anything that needs words to the LLM", async () => {
    const s = stack({
      self: noul(0.12),
      tool: choice("click_element", 0.7),
      target: choice("Create project button", 1),
    });
    const events: JevRouteEvent[] = [];
    const res = await handlerFor(s, events)(post([{ role: "user", content: "how do I make a project?" }]));
    expect(await res.json()).toEqual({ choices: [{ message: { content: "from the llm" } }] });
    expect(s.llm).toHaveLength(1);
    expect(events[0]!.reason).toBe("needs-llm");
  });

  test("an unsure target goes to the LLM", async () => {
    const s = stack({
      self: noul(0.9),
      tool: choice("highlight_element", 0.95),
      target: choice("Settings nav link", 0.55),
    });
    await handlerFor(s)(post([{ role: "user", content: "show me the Apollo project" }]));
    expect(s.llm).toHaveLength(1);
  });

  test("a confident target that isn't on screen goes to the LLM", async () => {
    const s = stack({ self: noul(0.9), tool: choice("highlight_element", 1), target: choice("Ghost element", 0.99) });
    await handlerFor(s)(post([{ role: "user", content: "show me the ghost" }]));
    expect(s.llm).toHaveLength(1);
  });

  test("a wrong-typed answer for the target goes to the LLM", async () => {
    const s = stack({ self: noul(0.9), tool: choice("highlight_element", 1), target: noul(0.99) });
    await handlerFor(s)(post([{ role: "user", content: "where are the settings?" }]));
    expect(s.llm).toHaveLength(1);
  });

  test("closes the turn with a reply once its steps succeeded", async () => {
    const s = stack({
      done: noul(0.9),
      self: noul(0.5),
      tool: choice("highlight_element", 0.9),
      target: choice("Settings nav link", 1),
    });
    const res = await handlerFor(s)(
      post([
        { role: "user", content: "where are the settings?" },
        jevCall("jev_1", "highlight_element", { target: "Settings nav link" }),
        { role: "tool", tool_call_id: "jev_1", content: 'Done: highlighted "Settings nav link".' },
      ]),
    );
    const json = (await res.json()) as { choices: Array<{ finish_reason: string; message: Body }> };
    expect(json.choices[0]!.message).toEqual({ role: "assistant", content: "Here it is." });
    expect(json.choices[0]!.finish_reason).toBe("stop");
    expect(s.llm).toHaveLength(0);

    const state = s.jev[0]!["state"] as Body;
    expect(state["actions_taken"]).toEqual([
      {
        action: "highlight_element",
        arguments: { target: "Settings nav link" },
        result: 'Done: highlighted "Settings nav link".',
      },
    ]);
    expect(Object.keys(s.jev[0]!["questions"] as Body)).toContain("done");
  });

  test("never repeats a step it already took", async () => {
    const s = stack({
      done: noul(0.02),
      self: noul(0.9),
      tool: choice("highlight_element", 1),
      target: choice("Settings nav link", 1),
    });
    const events: JevRouteEvent[] = [];
    await handlerFor(
      s,
      events,
    )(
      post([
        { role: "user", content: "where are the settings?" },
        jevCall("jev_1", "highlight_element", { target: "Settings nav link" }),
        { role: "tool", tool_call_id: "jev_1", content: "That didn't work." },
      ]),
    );
    expect(events[0]!.reason).toBe("repeat");
    expect(s.llm).toHaveLength(1);
  });

  test("once the LLM has spoken in a turn, the turn stays with it", async () => {
    const s = stack({ self: noul(1), tool: choice("click_element", 1), target: choice("Settings nav link", 1) });
    await handlerFor(s)(
      post([
        { role: "user", content: "open settings and explain them" },
        jevCall("call_llm", "click_element", { target: "Settings nav link" }),
        { role: "tool", tool_call_id: "call_llm", content: "Done." },
      ]),
    );
    expect(s.jev).toHaveLength(0);
    expect(s.llm).toHaveLength(1);
  });

  test("a new user message starts a fresh Jev turn", async () => {
    const s = stack({ self: noul(0.95), tool: choice("click_element", 1), target: choice("Settings nav link", 1) });
    await handlerFor(s)(
      post([
        { role: "user", content: "hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: "open settings" },
      ]),
    );
    expect(s.llm).toHaveLength(0);
    expect((s.jev[0]!["state"] as Body)["earlier_conversation"]).toEqual([
      { speaker: "user", text: "hi" },
      { speaker: "assistant", text: "Hello!" },
    ]);
  });

  test("stops after maxSteps Jev steps", async () => {
    const s = stack({
      done: noul(0.1),
      self: noul(0.95),
      tool: choice("click_element", 1),
      target: choice("Create project button", 1),
    });
    const events: JevRouteEvent[] = [];
    await handlerFor(s, events, { maxSteps: 1 })(
      post([
        { role: "user", content: "open settings then create a project" },
        jevCall("jev_1", "click_element", { target: "Settings nav link" }),
        { role: "tool", tool_call_id: "jev_1", content: "Done." },
      ]),
    );
    expect(events[0]!.reason).toBe("max-steps");
    expect(s.jev).toHaveLength(0);
  });

  test("falls through to the LLM when Jev errors", async () => {
    const s = stack(new Response("overloaded", { status: 529 }));
    const events: JevRouteEvent[] = [];
    const res = await handlerFor(s, events)(post([{ role: "user", content: "open settings" }]));
    expect(res.status).toBe(200);
    expect(s.llm).toHaveLength(1);
    expect(events[0]!.reason).toBe("error");
  });

  test("falls through to the LLM when Jev answers without answers", async () => {
    const s = stack(new Response(JSON.stringify({ model: "jev" }), { status: 200 }));
    const events: JevRouteEvent[] = [];
    const res = await handlerFor(s, events)(post([{ role: "user", content: "open settings" }]));
    expect(res.status).toBe(200);
    expect(s.llm).toHaveLength(1);
    expect(events[0]!.reason).toBe("error");
  });

  test("without a screen context there is nothing for Jev to target", async () => {
    const s = stack({ self: noul(1), tool: choice("click_element", 1), target: choice("Settings nav link", 1) });
    await handlerFor(s)(post([{ role: "user", content: "open settings" }], { sitepilot: undefined }));
    expect(s.jev).toHaveLength(0);
    expect(s.llm).toHaveLength(1);
  });

  test("fills enum and boolean arguments of opted-in custom tools", async () => {
    const custom = {
      type: "function",
      function: {
        name: "set_theme",
        description: "Switch the colour theme.",
        parameters: {
          type: "object",
          properties: { theme: { type: "string", enum: ["light", "dark"] }, animate: { type: "boolean" } },
          required: ["theme", "animate"],
        },
      },
    };
    const s = stack({
      self: noul(0.9),
      tool: choice("set_theme", 0.99),
      "set_theme.theme": choice("dark", 0.97, "light"),
      "set_theme.animate": noul(0.1),
    });
    const handler = createPilotHandler({
      apiKey: "sk",
      model: "m",
      fetch: s.fetch,
      router: jevRouter({ apiKey: "ts", fetch: s.fetch, tools: ["set_theme"] }),
    });
    const res = await handler(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "dark mode please" }], tools: [custom] }),
      }),
    );
    const json = (await res.json()) as {
      choices: Array<{ message: { tool_calls: Array<{ function: { arguments: string } }> } }>;
    };
    expect(JSON.parse(json.choices[0]!.message.tool_calls[0]!.function.arguments)).toEqual({
      theme: "dark",
      animate: false,
    });
    expect(Object.keys(s.jev[0]!["questions"] as Body).sort()).toEqual([
      "self",
      "set_theme.animate",
      "set_theme.theme",
      "tool",
    ]);

    const off = stack({
      self: noul(0.9),
      tool: choice("set_theme", 0.99),
      "set_theme.theme": choice("purple", 0.97, "light"),
      "set_theme.animate": noul(0.1),
    });
    const offHandler = createPilotHandler({
      apiKey: "sk",
      model: "m",
      fetch: off.fetch,
      router: jevRouter({ apiKey: "ts", fetch: off.fetch, tools: ["set_theme"] }),
    });
    await offHandler(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "purple mode please" }], tools: [custom] }),
      }),
    );
    expect(off.llm).toHaveLength(1);
  });

  describe("looking at the screen", () => {
    const computer = {
      type: "function",
      function: {
        name: "computer",
        description: "Act, then capture a frame.",
        parameters: { type: "object", properties: { actions: { type: "array" } }, required: ["actions"] },
      },
    };
    const frame = "data:image/png;base64,iVBORw0KGgo=";
    const withComputer = (messages: Body[]) =>
      new Request("http://x/api/pilot", {
        method: "POST",
        body: JSON.stringify({ messages, tools: [...tools, computer], sitepilot }),
      });
    const looked = [
      { role: "user", content: "open the project Linus owns" },
      jevCall("jev_look", "computer", { actions: [] }),
      {
        role: "tool",
        tool_call_id: "jev_look",
        content: JSON.stringify({
          executed: 0,
          elements: [
            { key: "Settings nav link", x: 1, y: 1, w: 9, h: 9 },
            { key: "Project card: Cassini", x: 400, y: 90, w: 120, h: 110 },
          ],
        }),
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached: media." },
          { type: "image_url", image_url: { url: frame } },
        ],
      },
    ];

    test("takes a frame when the text list can't pin the target", async () => {
      const s = stack({
        self: noul(0.3),
        tool: choice("click_element", 0.9),
        target: choice("Settings nav link", 0.4),
        on_screen: noul(0.82),
      });
      const events: JevRouteEvent[] = [];
      const res = await handlerFor(s, events)(withComputer([{ role: "user", content: "open the project Linus owns" }]));
      const json = (await res.json()) as {
        choices: Array<{
          message: { tool_calls: Array<{ id: string; function: { name: string; arguments: string } }> };
        }>;
      };
      const call = json.choices[0]!.message.tool_calls[0]!;
      expect(call.id.startsWith("jev_")).toBe(true);
      expect(call.function.name).toBe("computer");
      expect(JSON.parse(call.function.arguments)).toEqual({ actions: [] });
      expect(events[0]!.reason).toBe("look");
      expect(s.llm).toHaveLength(0);
      expect(s.jev[0]!["assets"]).toBeUndefined();
    });

    test("picks from the picture, items in the frame included", async () => {
      const s = stack({
        self: noul(0.9),
        tool: choice("click_element", 0.95),
        target: choice("Project card: Cassini", 0.97),
      });
      const res = await handlerFor(s)(withComputer(looked));
      const json = (await res.json()) as {
        choices: Array<{ message: { tool_calls: Array<{ function: { name: string; arguments: string } }> } }>;
      };
      expect(JSON.parse(json.choices[0]!.message.tool_calls[0]!.function.arguments)).toEqual({
        target: "Project card: Cassini",
      });

      const asked = s.jev[0]!;
      const screen = (asked["state"] as Body)["screen"] as { picture: string; elements: Array<{ key: string }> };
      expect(asked["assets"]).toEqual({
        [screen.picture]: { type: "image", format: "png", data_base64: "iVBORw0KGgo=" },
      });
      expect(s.jevHeaders[0]!.get("typesafe-danger-zone-images")).toBe("true");
      expect(screen.elements.map((e) => e.key)).toEqual([
        "Settings nav link",
        "Project card: Cassini",
        "Create project button",
      ]);
      expect((asked["state"] as Body)["actions_taken"]).toBeUndefined();
      expect(Object.keys(asked["questions"] as Body)).not.toContain("on_screen");
    });

    test("looks once per turn, then hands off", async () => {
      const s = stack({
        self: noul(0.4),
        tool: choice("click_element", 0.9),
        target: choice("Project card: Cassini", 0.5),
      });
      const events: JevRouteEvent[] = [];
      await handlerFor(s, events)(withComputer(looked));
      expect(events[0]!.reason).toBe("needs-llm");
      expect(s.llm).toHaveLength(1);
    });

    test("the picture is only used in the round right after the look", async () => {
      const s = stack({
        done: noul(0.9),
        self: noul(0.1),
        tool: choice("click_element", 1),
        target: choice("Settings nav link", 1),
      });
      const res = await handlerFor(s)(
        withComputer([
          ...looked,
          jevCall("jev_2", "click_element", { target: "Project card: Cassini" }),
          { role: "tool", tool_call_id: "jev_2", content: 'Done: clicked "Project card: Cassini".' },
        ]),
      );
      expect(s.jev[0]!["assets"]).toBeUndefined();
      expect((s.jev[0]!["state"] as Body)["actions_taken"]).toEqual([
        {
          action: "click_element",
          arguments: { target: "Project card: Cassini" },
          result: 'Done: clicked "Project card: Cassini".',
        },
      ]);
      expect(((await res.json()) as { choices: Array<{ message: Body }> }).choices[0]!.message["content"]).toBe(
        "Done.",
      );
    });

    test("look: false keeps pictures away from TypeSafe", async () => {
      const s = stack({
        self: noul(0.3),
        tool: choice("click_element", 0.9),
        target: choice("Settings nav link", 0.4),
        on_screen: noul(0.9),
      });
      await handlerFor(s, [], { look: false })(
        withComputer([{ role: "user", content: "open the project Linus owns" }]),
      );
      expect(Object.keys(s.jev[0]!["questions"] as Body)).not.toContain("on_screen");
      expect(s.llm).toHaveLength(1);
    });
  });
});
