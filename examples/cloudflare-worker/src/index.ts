import { createPilotHandler } from "@sitepilot/server";

interface Env {
  PILOT_API_KEY: string;
  PILOT_BASE_URL: string;
  PILOT_MODEL: string;
  ALLOW_ORIGINS: string;
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (env.LIMITER) {
      const key = request.headers.get("cf-connecting-ip") ?? "anon";
      const { success } = await env.LIMITER.limit({ key });
      if (!success) return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
    }
    const handler = createPilotHandler({
      apiKey: env.PILOT_API_KEY,
      baseURL: env.PILOT_BASE_URL,
      model: env.PILOT_MODEL,
      allowOrigins: env.ALLOW_ORIGINS.split(",").map((s) => s.trim()),
      maxMessages: 40,
      prompt: {
        system:
          "You are the guide to this portfolio site. Be brief and friendly. Point at things with highlight_element rather than describing where they are.",
      },
    });
    return handler(request);
  },
};
