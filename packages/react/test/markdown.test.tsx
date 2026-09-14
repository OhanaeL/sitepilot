import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../src/markdown";

const html = (s: string) => renderToStaticMarkup(<>{renderMarkdown(s)}</>);

describe("renderMarkdown", () => {
  test("paragraphs, bold, italic, code, links", () => {
    expect(html("One **bold** and *em* and `x` [site](https://a.b/c).\n\nTwo")).toBe(
      '<p>One <strong>bold</strong> and <em>em</em> and <code>x</code> <a href="https://a.b/c" target="_blank" rel="noopener noreferrer">site</a>.</p><p>Two</p>',
    );
  });

  test("lists and code fences", () => {
    expect(html("- a\n- **b**\n\n1. one\n2) two\n\n```\nlet x;\n```")).toBe(
      "<ul><li>a</li><li><strong>b</strong></li></ul><ol><li>one</li><li>two</li></ol><pre><code>let x;</code></pre>",
    );
  });

  test("soft line breaks inside a paragraph; unsafe link schemes stay text", () => {
    expect(html("a\nb")).toBe("<p>a<br/>b</p>");
    expect(html("[x](javascript:alert(1))")).toBe("<p>[x](javascript:alert(1))</p>");
  });
});
