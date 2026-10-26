import { describe, expect, test } from "bun:test";
import { buildToolSpecs, parseToolArgs } from "../src/tools";
import { BUILTIN_TOOLS } from "../src/builtin-tools";
import { buildSystemPrompt, renderScreen } from "../src/prompt";
import { parseCompletion } from "../src/transport";

describe("buildToolSpecs", () => {
  test("nothing enabled advertises nothing", () => {
    expect(buildToolSpecs(BUILTIN_TOOLS, [])).toEqual([]);
    expect(buildToolSpecs(BUILTIN_TOOLS, ["bogus"])).toEqual([]);
  });

  test("enabled actions bring get_screen_elements and omit the rest", () => {
    const names = buildToolSpecs(BUILTIN_TOOLS, ["highlight_element", "fill_field"]).map((t) => t.function.name);
    expect(names).toEqual(["highlight_element", "fill_field", "get_screen_elements"]);
  });
});

describe("parseToolArgs", () => {
  test("accepts JSON strings, objects, and garbage", () => {
    expect(parseToolArgs('{"target":"x"}')).toEqual({ target: "x" });
    expect(parseToolArgs({ target: "y" })).toEqual({ target: "y" });
    expect(parseToolArgs("nope")).toEqual({});
    expect(parseToolArgs(undefined)).toEqual({});
  });
});

describe("prompt", () => {
  const ctx = {
    path: "/projects",
    ambient: [{ key: "Create Project button", description: "Create Project button", tier: "ambient" as const }],
    events: [{ type: "click" as const, key: "Nav", tier: "ambient" as const, at: 0, lastMove: true }],
    area: { topic: "projects", description: "The projects list" },
  };

  test("renders route, elements, area, and events", () => {
    const text = renderScreen(ctx);
    expect(text).toContain("route /projects");
    expect(text).toContain("- Create Project button");
    expect(text).toContain("This area: The projects list");
    expect(text).toContain("(last) click Nav");
  });

  test("prompt composition: base, briefs, screen, user, extra", () => {
    const full = buildSystemPrompt(
      { screen: ctx, user: { name: "Ada" }, extra: "Plan: pro", briefs: ["BRIEF"], enabledTools: [] },
      { system: "BASE" },
    );
    expect(full).toMatch(/^BASE\n\nBRIEF\n\nCURRENT SCREEN/);
    expect(full).toContain("ABOUT THE USER:\n- name: Ada");
    expect(full).toMatch(/Plan: pro$/);
    const noBriefs = buildSystemPrompt(
      { screen: ctx, user: null, extra: null, briefs: ["BRIEF"], enabledTools: [] },
      { briefs: false },
    );
    expect(noBriefs).not.toContain("BRIEF");
  });
});

describe("parseCompletion", () => {
  test("extracts content and tool calls", () => {
    const reply = parseCompletion({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "click_element", arguments: '{"target":"Save button"}' },
              },
            ],
          },
        },
      ],
    });
    expect(reply.content).toBe("");
    expect(reply.toolCalls).toEqual([{ id: "c1", name: "click_element", args: { target: "Save button" } }]);
  });

  test("keeps the completion's model so the transcript can say who answered", () => {
    expect(parseCompletion({ model: "jev", choices: [{ message: { content: "Hi" } }] }).model).toBe("jev");
    expect(parseCompletion({ choices: [{ message: { content: "Hi" } }] })).not.toHaveProperty("model");
  });

  test("throws on an error body", () => {
    expect(() => parseCompletion({ error: { message: "bad key" } })).toThrow("bad key");
  });
});

describe("hints in the prompt", () => {
  const screen = {
    path: "/",
    ambient: [
      {
        key: "Create project button",
        description: "Create project button",
        tier: "ambient" as const,
        hint: "Opens the dialog.",
      },
      { key: "Project card #2", description: "Project card #2", tier: "ambient" as const },
    ],
    events: [],
    area: null,
  };

  test("element hints render after an em dash; label-keyed hints ignore ordinals and merge", () => {
    const text = renderScreen(screen, 40, {
      "Project card": "A project the user owns.",
      "Create project button": "Pro plan only.",
    });
    expect(text).toContain("- Create project button: Create project button — Opens the dialog. Pro plan only.");
    expect(text).toContain("- Project card #2: Project card #2 — A project the user owns.");
  });

  test("hints may be a function", () => {
    const text = renderScreen(screen, 40, (e) => (e.key.startsWith("Project") ? "fn hint" : undefined));
    expect(text).toContain("Project card #2 — fn hint");
    expect(text).toContain("Create project button — Opens the dialog.\n");
  });
});
