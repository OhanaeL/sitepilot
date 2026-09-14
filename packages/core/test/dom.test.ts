import { beforeEach, describe, expect, test } from "bun:test";
import { resolveKey, scanAmbient, scanContext, scanItems } from "../src/dom";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("scanAmbient", () => {
  test("lists visible data-pilot elements with ordinal keys on collision", () => {
    document.body.innerHTML = `
      <button data-pilot="Save button"></button>
      <button data-pilot="Save button"></button>
      <button data-pilot="Hidden" data-test-hidden></button>
      <div aria-hidden="true"><button data-pilot="Behind modal"></button></div>
      <div data-pilot-panel><button data-pilot="Inside panel"></button></div>`;
    expect(scanAmbient().map((e) => e.key)).toEqual(["Save button", "Save button #2"]);
  });

  test("surfaces field values but never passwords", () => {
    document.body.innerHTML = `
      <input data-pilot="Name field" value="Ada">
      <input data-pilot="Password field" type="password" value="hunter2">
      <div data-pilot="Wrapped"><textarea>hello  world</textarea></div>`;
    expect(scanAmbient().map((e) => e.description)).toEqual([
      "Name field: “Ada”",
      "Password field",
      "Wrapped: “hello world”",
    ]);
  });

  test("data-pilot-read exposes rendered text", () => {
    document.body.innerHTML = `<section data-pilot="Details" data-pilot-read>Owner: Ada  <b>Status</b>: open</section>`;
    expect(scanAmbient()[0]?.description).toBe("Details: “Owner: Ada Status: open”");
  });

  test("respects maxElements", () => {
    document.body.innerHTML = Array.from({ length: 5 }, (_, i) => `<b data-pilot="Item ${i}"></b>`).join("");
    expect(scanAmbient({ maxElements: 2 })).toHaveLength(2);
  });
});

describe("scanItems", () => {
  test("only returns the item tier", () => {
    document.body.innerHTML = `<b data-pilot="Nav"></b><li data-pilot-item="Project card: Acme"></li>`;
    expect(scanItems().map((e) => e.key)).toEqual(["Project card: Acme"]);
  });
});

describe("scanContext", () => {
  test("deepest reachable marker wins", () => {
    document.body.innerHTML = `
      <main data-pilot-context="projects" data-pilot-context-description="The projects list">
        <div role="dialog"><span data-pilot-context="create-project" aria-hidden="true"></span></div>
      </main>`;
    expect(scanContext()).toEqual({ topic: "create-project", description: "create-project" });
  });

  test("marker behind a modal is ignored", () => {
    document.body.innerHTML = `
      <main aria-hidden="true"><span data-pilot-context="projects"></span></main>
      <div role="dialog"><span data-pilot-context="modal"></span></div>`;
    expect(scanContext()?.topic).toBe("modal");
  });

  test("null with no marker", () => {
    expect(scanContext()).toBeNull();
  });
});

describe("resolveKey", () => {
  test("exact ordinal keys resolve across tiers in one namespace", () => {
    document.body.innerHTML = `<b id="a" data-pilot="Card"></b><b id="b" data-pilot-item="Card"></b>`;
    expect(resolveKey("Card")?.id).toBe("a");
    expect(resolveKey("Card #2")?.id).toBe("b");
  });

  test("paraphrased key resolves when unique, not when ambiguous or tiny", () => {
    document.body.innerHTML = `
      <b id="cp" data-pilot="Create Project button — opens the dialog"></b>
      <b id="s1" data-pilot="Search projects"></b>
      <b id="s2" data-pilot="Search people"></b>`;
    expect(resolveKey("create project button")?.id).toBe("cp");
    expect(resolveKey("Search")).toBeNull();
    expect(resolveKey("Search proj")?.id).toBe("s1");
  });

  test("unmounted key is null", () => {
    expect(resolveKey("Nothing")).toBeNull();
  });
});
