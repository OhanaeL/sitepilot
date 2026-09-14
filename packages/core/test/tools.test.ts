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

  test("custom base prompt is honoured", () => {
    expect(buildSystemPrompt(ctx, "BASE")).toMatch(/^BASE\n\nCURRENT SCREEN/);
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
              { id: "c1", type: "function", function: { name: "click_element", arguments: '{"target":"Save button"}' } },
            ],
          },
        },
      ],
    });
    expect(reply.content).toBe("");
    expect(reply.toolCalls).toEqual([{ id: "c1", name: "click_element", args: { target: "Save button" } }]);
  });

  test("throws on an error body", () => {
    expect(() => parseCompletion({ error: { message: "bad key" } })).toThrow("bad key");
  });
});
