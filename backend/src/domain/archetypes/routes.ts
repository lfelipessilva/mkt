import type { FastifyPluginAsync } from "fastify";
import {
  listArchetypes,
  replaceArchetypesForScope,
  getArchetype,
  deleteArchetype,
} from "./store.js";
import {
  GetArchetypesQuerySchema,
  PutArchetypesSchema,
} from "./schemas.js";
import { AppError } from "../../shared/errors.js";

export const archetypesRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/archetypes?scope=shared
  app.get("/", async (request, reply) => {
    const parsed = GetArchetypesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const archetypes = await listArchetypes(parsed.data.scope);
    return reply.send(archetypes);
  });

  // GET /api/v1/archetypes/:id
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const archetype = await getArchetype(id);
    if (!archetype) {
      throw new AppError(`Archetype '${id}' not found`, 404, "not_found");
    }
    return reply.send(archetype);
  });

  // PUT /api/v1/archetypes body { scope, items: [...] }
  app.put("/", async (request, reply) => {
    const parsed = PutArchetypesSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const updated = await replaceArchetypesForScope(
      parsed.data.scope,
      parsed.data.items
    );
    return reply.send(updated);
  });

  // DELETE /api/v1/archetypes/:id
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteArchetype(id);
    return reply.send({ success: true });
  });
};
