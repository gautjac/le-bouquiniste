import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serves /api/proxy during `npm run dev` with the exact same handler Netlify runs
 * in production (netlify/functions/lib/proxy.ts), so there is one code path to trust.
 */
function devApi(): Plugin {
  return {
    name: "bouquiniste-dev-api",
    configureServer(server) {
      server.middlewares.use("/api/proxy", async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const mod = await server.ssrLoadModule("/netlify/functions/lib/proxy.ts");
          const search = new URL(req.url ?? "/", "http://localhost").search;
          const request = new Request(`http://localhost/api/proxy${search}`, {
            method: req.method,
          });
          const response: Response = await mod.handleProxy(request);
          res.statusCode = response.status;
          response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
          if (response.body) {
            Readable.fromWeb(response.body as never).pipe(res);
          } else {
            res.end();
          }
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain; charset=utf-8");
          res.end(`Proxy error: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApi()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "netlify/**/*.test.ts"],
  },
});
