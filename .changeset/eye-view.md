---
"@sitepilot/core": minor
"@sitepilot/react": minor
---

Eye view: `pilot.showSeen()` and the widget's eye button outline every element the model is sent, using the prompt's own scan, keys and caps. Visible elements get an outline on the element itself (solid for the ambient tier, dashed for items while the model can pull them), elements the page hides get a red hatch, and elements scrolled away or under a fixed or sticky layer get nothing. Replies carry the model that answered (`PilotMessage.by`, from `CompletionReply.model`), shown under each message while the eye is on and formatted by the widget's `modelLabel` prop. An empty `subtitle` hides the line under the title.
