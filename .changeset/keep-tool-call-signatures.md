---
"@sitepilot/core": patch
"@sitepilot/server": patch
---

Tool calls keep a provider's `extra_content` on replay. Gemini 3 attaches a `thought_signature` to each tool call and rejects the next request without it; the server used to drop the field, so every follow-up after a tool call returned 400. It now passes a plain object of up to 16 KB through unchanged.
