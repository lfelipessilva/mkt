import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import { getAllSettings, getSetting, setSetting } from "./store.js";

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
