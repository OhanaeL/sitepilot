---
"@sitepilot/core": patch
"@sitepilot/computer": patch
---

A stopped run stops acting: `ToolContext.signal` aborts on `stop()`, `click`/`fill`/`highlight` take `{ root, signal }` and give up before touching the page, and the computer plugin checks it between batch actions. Keys resolve inside `scan.root`, where the prompt listed them. A history restored with tool calls left open is repaired before the next turn.
