import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "http";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Let us decide how to forward each response so we can
        // bypass http-proxy's default pipe for SSE streams.
        selfHandleResponse: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Accept-Encoding", "identity");
          });

          // Forward every response ourselves. For SSE streams we write
          // each chunk immediately; for everything else we just pipe.
          proxy.on(
            "proxyRes",
            (
              proxyRes: IncomingMessage,
              _req: IncomingMessage,
              res: ServerResponse,
            ) => {
              // Copy status + headers from the upstream response
              res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);

              const isSSE = (proxyRes.headers["content-type"] ?? "").includes(
                "text/event-stream",
              );

              if (isSSE) {
                // Write every chunk to the client as soon as it arrives
                // so SSE tokens are not held in an internal buffer.
                proxyRes.on("data", (chunk: Buffer) => {
                  res.write(chunk);
                });
                proxyRes.on("end", () => {
                  res.end();
                });
              } else {
                // Non-SSE: normal pipe is fine
                proxyRes.pipe(res);
              }
            },
          );
        },
      },
    },
  },
});
