---
"@sitepilot/core": patch
"@sitepilot/server": patch
"@sitepilot/react": patch
---

Fixes:
- One key namespace across both tiers, so the prompt and the resolver agree on a label found in both; ordinals never reuse a label already on the page.
- A malformed Jev reply or a throwing router hands the round to the LLM instead of failing the request.
- `Origin: null` gets a 403 instead of an error.
- `stop()` then `send()`: the stopped run no longer resets the new one or writes its late tool result into its history.
- Markdown renders no link for `//host`, `/\host`, backslashes or paren-free `javascript:` URLs.
- Client `system` messages are dropped while a server `prompt` is configured.

Core's public exports are now an explicit list; manifest plumbing, the events installer, test resets and tool-spec builders are internal. `PilotStrings` gains `stopped`.
