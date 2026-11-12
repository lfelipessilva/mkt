import http from "node:http";
import { getJobStatus } from "./jobLock.js";

export function createServer({ port }) {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/health")) {
      const body = JSON.stringify({
        ok: true,
        uptime: process.uptime(),
        job: getJobStatus(),
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
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
