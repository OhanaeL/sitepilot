# sitepilot on a static site

A static site (GitHub Pages, Netlify, S3…) can run the whole sitepilot browser side; the only thing it cannot hold is an LLM key. This Worker is that one missing piece: `createPilotHandler` on Cloudflare's free tier, locked to your site's origin.

```bash
cd examples/cloudflare-worker
bunx wrangler login
bunx wrangler secret put PILOT_API_KEY      # a budget-capped key (LiteLLM virtual key with max_budget, or an OpenAI project key with a limit)
bunx wrangler deploy                        # → https://sitepilot-pilot.<you>.workers.dev
```

Edit `wrangler.toml` for the model, the upstream base URL and the allowed origins. In the site:

```ts
openaiTransport({ url: "https://sitepilot-pilot.<you>.workers.dev" })
```

Keep `allowOrigins` tight and the key's budget small — the endpoint is public by design.
