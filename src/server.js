import http from "node:http";
import { config } from "./config.js";
import { getJobStatus, withJobLock } from "./jobLock.js";
import { runRenameImages } from "./pipeline/renameImages.js";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createServer({ port }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      json(res, 200, {
        ok: true,
        uptime: process.uptime(),
        job: getJobStatus(),
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/rename-images") {
      const force = url.searchParams.get("force") === "1";
      try {
        const result = await withJobLock(() =>
          runRenameImages({
            mediaDirs: config.media,
            apiKey: config.geminiApiKey,
            model: config.geminiModel,
            force,
          }),
        );
        json(res, 200, { ok: true, ...result });
      } catch (e) {
        if (e.code === "BUSY") {
          json(res, 409, { ok: false, error: e.message, job: getJobStatus() });
          return;
        }
        json(res, 500, { ok: false, error: e.message });
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  return {
    app: server,
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "0.0.0.0", () => resolve(server));
      });
    },
  };
}
