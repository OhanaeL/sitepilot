import { createPilotHandler, toNodeListener } from "@sitepilot/server";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

function pilotApi(env: Record<string, string>): Plugin {
  return {
    name: "sitepilot-api",
    configureServer(server) {
      const handler = createPilotHandler({
        apiKey: env["PILOT_API_KEY"] ?? "",
        baseURL: env["PILOT_BASE_URL"] || "https://api.openai.com/v1",
        model: env["PILOT_MODEL"] || "gpt-4o-mini",
        prompt: {
          system: [
            "You are Pip, the Acme Projects assistant. Cheerful, brief, never more than two sentences.",
            "Target elements only by the exact keys under CURRENT SCREEN. Prefer highlight_element for 'where is' questions.",
            "Never click a Create/confirm button yourself — fill things in, then hand the last click to the user.",
          ].join(" "),
          extra: (_ctx, req) => `Request came from ${req.headers.get("user-agent")?.split(" ")[0] ?? "unknown"}.`,
          hints: {
            "Search projects field": "Filters the cards live as the user types; matching is case-insensitive on the name.",
            "Password field": "NEVER read, fill, or mention this field's value. If asked, tell the user to change it themselves.",
          },
        },
        toolDescriptions: {
          click_element: "Click a button or link for the user. NEVER the Create/confirm button in the New project dialog.",
        },
      });
      server.middlewares.use("/api/pilot", toNodeListener(handler));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "PILOT_");
  return { plugins: [react(), pilotApi(env)] };
});
