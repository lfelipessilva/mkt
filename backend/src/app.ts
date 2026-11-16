import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import fs from "node:fs";
import { authenticateBearer } from "./platform/auth.js";
import { isAppError } from "./shared/errors.js";
import { accountsRoutes } from "./domain/accounts/routes.js";
import { archetypesRoutes } from "./domain/archetypes/routes.js";
import { baitsRoutes } from "./domain/baits/routes.js";
import { mediaRoutes } from "./domain/media/routes.js";
import { runsRoutes } from "./domain/runs/routes.js";
import { dispatchRoutes } from "./domain/dispatch/routes.js";
import { tiktokRoutes } from "./domain/tiktok/routes.js";
import { settingsRoutes } from "./domain/settings/routes.js";
import { socialRoutes, socialWebhookRoutes } from "./domain/social/routes.js";

function resolveFrontendDist(): string | null {
  const candidateDirs = [
    process.env.FRONTEND_DIST_DIR,
    path.resolve(process.cwd(), "frontend/dist"),
    path.resolve(process.cwd(), "../frontend/dist"),
    path.resolve("/app/frontend/dist"),
  ];
  for (const dir of candidateDirs) {
    if (dir && fs.existsSync(path.join(dir, "index.html"))) {
      return dir;
    }
  }
  return null;
}

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
  });

  // Register multipart support for file uploads (50MB limit)
  app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024,
    },
  });

  const frontendDist = resolveFrontendDist();
  if (frontendDist) {
    app.register(fastifyStatic, {
      root: frontendDist,
      prefix: "/",
      wildcard: false,
    });
  }

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
      v1.register(archetypesRoutes, { prefix: "/archetypes" });
      v1.register(baitsRoutes, { prefix: "/baits" });
      v1.register(mediaRoutes, { prefix: "/media" });
      v1.register(runsRoutes, { prefix: "/carousels" });
      v1.register(dispatchRoutes, { prefix: "/carousels" });
      v1.register(tiktokRoutes, { prefix: "/tiktok" });
      v1.register(settingsRoutes, { prefix: "/settings" });
      v1.register(socialRoutes, { prefix: "/social" });
    },
    { prefix: "/api/v1" }
  );

  // Webhooks (public / non-bearer authenticated)
  app.register(socialWebhookRoutes, { prefix: "/api/v1/webhooks" });

  // SPA fallback for non-API client routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({
        error: "not_found",
        message: "API endpoint not found",
      });
    }
    if (frontendDist && fs.existsSync(path.join(frontendDist, "index.html"))) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: "not_found",
      message: "Resource not found",
    });
  });

  return app;
}
