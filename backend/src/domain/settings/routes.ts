import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getAllSettings, getSetting, setSetting } from "./store.js";
import { validatePostWindows } from "../automation/windows.js";

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/settings
  app.get("/", async (_request, reply) => {
    const settings = await getAllSettings();
    return reply.send(settings);
  });

  // GET /api/v1/settings/:key
  app.get("/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const value = await getSetting(key);
    if (value === null) {
      throw new AppError(`Setting '${key}' not found`, 404, "not_found");
    }
    return reply.send({ key, value });
  });

  // PUT /api/v1/settings/:key
  app.put("/:key", async (request, reply) => {
    const { key } = request.params as { key: string };
    const body = (request.body || {}) as { value?: any };
    if (!("value" in body)) {
      throw new AppError("Body must contain 'value'", 400, "validation_error");
    }

    if (key === "auto_post_windows") {
      let windows = body.value;
      if (typeof windows === "string") {
        try {
          windows = JSON.parse(windows);
        } catch {
          throw new AppError("invalid window format: must be valid JSON", 400, "validation_error");
        }
      }
      try {
        validatePostWindows(windows);
      } catch (err: any) {
        throw new AppError(err?.message || "invalid auto_post_windows", 400, "validation_error");
      }
    } else if (key === "auto_post_count_per_day") {
      const count = body.value;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 6) {
        throw new AppError("auto_post_count_per_day must be an integer between 1 and 6", 400, "validation_error");
      }
    } else if (key === "auto_post_timezone") {
      const tz = body.value;
      if (typeof tz !== "string" || tz.trim() === "") {
        throw new AppError("auto_post_timezone must be a non-empty string", 400, "validation_error");
      }
    }

    const updated = await setSetting(key, body.value);
    return reply.send(updated);
  });

  // POST /api/v1/settings/test-dispatch
  app.post("/test-dispatch", async (_request, reply) => {
    return reply.send({
      ok: true,
      message: "Disparo de teste simulado com sucesso",
      timestamp: new Date().toISOString(),
    });
  });
};
