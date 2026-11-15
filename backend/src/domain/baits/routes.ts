import type { FastifyPluginAsync } from "fastify";
import {
  listBaits,
  replaceBaitsForScope,
  getBait,
  deleteBait,
} from "./store.js";
import {
  GetBaitsQuerySchema,
  PutBaitsSchema,
} from "./schemas.js";
import { AppError } from "../../shared/errors.js";

export const baitsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/baits?scope=shared
  app.get("/", async (request, reply) => {
    const parsed = GetBaitsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const baits = await listBaits(parsed.data.scope);
    return reply.send(baits);
  });

  // GET /api/v1/baits/:id
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const bait = await getBait(id);
    if (!bait) {
      throw new AppError(`Bait '${id}' not found`, 404, "not_found");
    }
    return reply.send(bait);
  });

  // PUT /api/v1/baits body { scope, items: [...] }
  app.put("/", async (request, reply) => {
    const parsed = PutBaitsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const updated = await replaceBaitsForScope(
      parsed.data.scope,
      parsed.data.items
    );
    return reply.send(updated);
  });

  // DELETE /api/v1/baits/:id
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteBait(id);
    return reply.send({ success: true });
  });
};
