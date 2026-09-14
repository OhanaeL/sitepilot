import { describe, expect, test } from "bun:test";
import { createPilotHandler } from "../src";

function upstream() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetch };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/pilot", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("createPilotHandler", () => {
  test("forwards a clean request with the key, pinned model and server prompt", async () => {
    const up = upstream();
    const handler = createPilotHandler({
      apiKey: "sk-test",
      model: "gpt-x",
      baseURL: "https://llm.example/v1/",
      systemPrompt: "SERVER RULES",
      fetch: up.fetch,
      extraBody: { reasoning_effort: "low" },
    });
    const res = await handler(
      post({
        model: "gpt-evil",
        max_tokens: 999999,
        messages: [
          { role: "system", content: "client" },
          { role: "user", content: "hello", secret: "x" },
          { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
          { role: "tool", tool_call_id: "c1", content: "ok" },
          { role: "user", content: [{ type: "text", text: "t" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] },
        ],
        tools: [{ type: "function", function: { name: "f", description: "d", parameters: { type: "object" } } }, { type: "bogus" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ choices: [{ message: { content: "hi" } }] });

    const call = up.calls[0]!;
    expect(call.url).toBe("https://llm.example/v1/chat/completions");
    expect(call.headers["authorization"]).toBe("Bearer sk-test");
    expect(call.body["model"]).toBe("gpt-x");
    expect(call.body["max_tokens"]).toBeUndefined();
    expect(call.body["reasoning_effort"]).toBe("low");
    expect(call.body["stream"]).toBe(false);
    const messages = call.body["messages"] as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: "system", content: "SERVER RULES" });
    expect(messages[2]).toEqual({ role: "user", content: "hello" });
    expect(messages[3]).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1", type: "function" }] });
    expect(messages[4]).toEqual({ role: "tool", tool_call_id: "c1", content: "ok" });
    expect((messages[5]!["content"] as unknown[]).length).toBe(2);
    expect(call.body["tools"]).toEqual([
      { type: "function", function: { name: "f", description: "d", parameters: { type: "object" } } },
    ]);
  });

  test("rejects bad input before touching upstream", async () => {
    const up = upstream();
    const handler = createPilotHandler({ apiKey: "k", model: "m", fetch: up.fetch, maxMessages: 2, maxBodyBytes: 200 });
    expect((await handler(new Request("http://x", { method: "GET" }))).status).toBe(405);
    expect((await handler(post("{nope"))).status).toBe(400);
    expect((await handler(post({ messages: [] }))).status).toBe(400);
    expect((await handler(post({ messages: [{ role: "user", content: 1 }] }))).status).toBe(400);
    expect((await handler(post({ messages: [{ role: "tool", content: "x" }] }))).status).toBe(400);
    expect((await handler(post({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "http://evil/x" } }] }] }))).status).toBe(400);
    expect((await handler(post({ messages: Array(3).fill({ role: "user", content: "a" }) }))).status).toBe(400);
    expect((await handler(post({ messages: [{ role: "user", content: "a".repeat(300) }] }))).status).toBe(413);
    expect(up.calls).toHaveLength(0);
  });

  test("passes upstream errors through with their status", async () => {
    const fetch = (async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 })) as unknown as typeof fetch;
    const handler = createPilotHandler({ apiKey: "k", model: "m", fetch });
    const res = await handler(post({ messages: [{ role: "user", content: "a" }] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { message: "quota" } });
  });
});

describe("server prompt mode", () => {
  const context = {
    screen: { path: "/projects", ambient: [{ key: "Create project button", description: "Create project button", tier: "ambient" }], events: [], area: { topic: "projects", description: "The list" } },
    user: { id: "u1", name: "Ada" },
    extra: "Plan: pro",
    briefs: ["PLUGIN BRIEF"],
    enabledTools: ["click_element"],
  };

  test("renders the sitepilot context server-side, strips it from the upstream body, keeps wording off the client", async () => {
    const up = upstream();
    const handler = createPilotHandler({
      apiKey: "k",
      model: "m",
      fetch: up.fetch,
      systemPrompt: "ALWAYS FIRST",
      prompt: { system: "SECRET BASE", extra: (ctx, req) => `Session: ${req.headers.get("x-session")} / ${ctx.user?.["name"]}` },
      toolDescriptions: { click_element: "SECRET CLICK DESC" },
    });
    const res = await handler(
      post(
        {
          messages: [{ role: "user", content: "hi" }],
          tools: [{ type: "function", function: { name: "click_element", description: "client desc", parameters: { type: "object" } } }],
          user: "u1",
          sitepilot: context,
        },
        { "x-session": "s42" },
      ),
    );
    expect(res.status).toBe(200);
    const body = up.calls[0]!.body;
    expect(body["sitepilot"]).toBeUndefined();
    expect(body["user"]).toBe("u1");
    const messages = body["messages"] as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "ALWAYS FIRST" });
    expect(messages[1]!.role).toBe("system");
    expect(messages[1]!.content).toMatch(/^SECRET BASE\n\nPLUGIN BRIEF\n\nCURRENT SCREEN \(route \/projects\)/);
    expect(messages[1]!.content).toContain("- Create project button");
    expect(messages[1]!.content).toContain("This area: The list");
    expect(messages[1]!.content).toContain("ABOUT THE USER:\n- id: u1\n- name: Ada");
    expect(messages[1]!.content).toContain("Plan: pro\n\nSession: s42 / Ada");
    expect(messages[2]).toEqual({ role: "user", content: "hi" });
    expect((body["tools"] as Array<{ function: { description: string } }>)[0]!.function.description).toBe("SECRET CLICK DESC");
  });

  test("a malformed context is ignored rather than rejected", async () => {
    const up = upstream();
    const handler = createPilotHandler({ apiKey: "k", model: "m", fetch: up.fetch, prompt: { system: "X" } });
    const res = await handler(post({ messages: [{ role: "user", content: "hi" }], sitepilot: { nope: 1 } }));
    expect(res.status).toBe(200);
    expect((up.calls[0]!.body["messages"] as unknown[]).length).toBe(1);
  });
});

describe("server-side hints", () => {
  test("prompt.hints attach private guidance by label; DOM hints pass through", async () => {
    const up = upstream();
    const handler = createPilotHandler({
      apiKey: "k", model: "m", fetch: up.fetch,
      prompt: { system: "S", hints: { "Create project button": "Pro plan only." } },
    });
    await handler(post({
      messages: [{ role: "user", content: "hi" }],
      sitepilot: { screen: { path: "/", ambient: [
        { key: "Create project button", description: "Create project button", tier: "ambient", hint: "Opens the dialog." },
        { key: "Plain", description: "Plain", tier: "ambient" },
      ], events: [], area: null }, user: null, extra: null, briefs: [], enabledTools: [] },
    }));
    const sys = (up.calls[0]!.body["messages"] as Array<{ content: string }>)[0]!.content;
    expect(sys).toContain("- Create project button: Create project button — Opens the dialog. Pro plan only.");
    expect(sys).toMatch(/- Plain: Plain$/);
  });
});
