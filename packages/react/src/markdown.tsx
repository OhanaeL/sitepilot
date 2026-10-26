import { Fragment, type ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:|\/(?!\/))[^)\s]+\)|\*[^*\n]+\*)/g;

function inline(text: string, keyBase: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={key}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={key}>{part.slice(1, -1)}</em>;
    const link = i % 2 === 1 && part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <a key={key} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

/** Minimal, dependency-free markdown for chat replies: paragraphs, lists, code, bold/italic, links. */
export function renderMarkdown(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key++}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const items: string[] = [];
      const ordered = /^\s*\d/.test(line);
      while (i < lines.length) {
        const m = lines[i]!.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        items.push(m[1]!);
        i++;
      }
      // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt from the same string every render, never reordered
      const list = items.map((item, j) => <li key={j}>{inline(item, `${key}-${j}`)}</li>);
      blocks.push(ordered ? <ol key={key++}>{list}</ol> : <ul key={key++}>{list}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.startsWith("```") &&
      !/^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[i]!)
    ) {
      para.push(lines[i++]!);
    }
    blocks.push(
      <p key={key++}>
        {para.map((l, j) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt from the same string every render, never reordered
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(l, `${key}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return blocks;
}
