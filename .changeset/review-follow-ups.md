---
"@sitepilot/server": patch
---

JSON nested deep enough to overflow the stack when re-serialised no longer throws out of the handler: a too-deep `extra_content` is dropped, and a request that cannot be serialised upstream gets a 400. On a plain Node listener the throw was an unhandled rejection that could take the process down.
