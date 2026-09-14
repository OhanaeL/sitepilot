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
        systemPrompt: "You are the assistant for the Acme Projects demo app.",
      });
      server.middlewares.use("/api/pilot", toNodeListener(handler));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "PILOT_");
  return { plugins: [react(), pilotApi(env)] };
});
