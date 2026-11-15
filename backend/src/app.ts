import Fastify, { type FastifyInstance } from "fastify";
import { authenticateBearer } from "./platform/auth.js";
import { isAppError } from "./shared/errors.js";
import { accountsRoutes } from "./domain/accounts/routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  app.setErrorHandler((error, _request, reply) => {
    if (isAppError(error)) {
      return reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      (error as { validation?: unknown }).validation
    ) {
      return reply.code(400).send({
        error: "validation_error",
        message: error instanceof Error ? error.message : "Validation error",
      });
    }

    app.log.error(error);
    return reply.code(500).send({
      error: "internal_error",
      message: error instanceof Error ? error.message : "Internal Server Error",
    });
  });

  // Public routes
  app.get("/health", async (_request, reply) => {
    return reply.send({ ok: true });
  });

  // Protected /api/v1/* routes
  app.register(
    async (v1) => {
      v1.addHook("preHandler", authenticateBearer);

      v1.get("/ping", async (_request, reply) => {
        return reply.send({ ok: true });
      });

      v1.register(accountsRoutes, { prefix: "/accounts" });
    },
    { prefix: "/api/v1" }
  );

  return app;
}
