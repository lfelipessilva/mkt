import type { FastifyPluginAsync } from "fastify";
import {
  listAccounts,
  upsertAccount,
  deleteAccount,
  getAccount,
} from "./store.js";
import { CreateAccountSchema, UpdateAccountSchema } from "./schemas.js";
import { AppError } from "../../shared/errors.js";

export const accountsRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/accounts
  app.get("/", async (_request, reply) => {
    const accounts = await listAccounts();
    return reply.send(accounts);
  });

  // GET /api/v1/accounts/:id
  app.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await getAccount(id);
    if (!account) {
      throw new AppError(`Account '${id}' not found`, 404, "not_found");
    }
    return reply.send(account);
  });

  // POST /api/v1/accounts
  app.post("/", async (request, reply) => {
    const parsed = CreateAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const account = await upsertAccount(parsed.data);
    return reply.code(201).send(account);
  });

  // PATCH /api/v1/accounts/:id
  app.patch("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    const existing = await getAccount(id);
    if (!existing) {
      throw new AppError(`Account '${id}' not found`, 404, "not_found");
    }
    const account = await upsertAccount({
      ...parsed.data,
      id,
    });
    return reply.send(account);
  });

  // PATCH /api/v1/accounts (with id in body)
  app.patch("/", async (request, reply) => {
    const parsed = UpdateAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }
    if (!parsed.data.id) {
      throw new AppError(
        "Account id is required for PATCH /api/v1/accounts",
        400,
        "validation_error"
      );
    }
    const existing = await getAccount(parsed.data.id);
    if (!existing) {
      throw new AppError(
        `Account '${parsed.data.id}' not found`,
        404,
        "not_found"
      );
    }
    const account = await upsertAccount(parsed.data);
    return reply.send(account);
  });

  // DELETE /api/v1/accounts/:id
  app.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteAccount(id);
    return reply.send({ ok: true });
  });

  // DELETE /api/v1/accounts (id in query or body)
  app.delete("/", async (request, reply) => {
    const query = request.query as { id?: string };
    const body = (request.body as { id?: string }) || {};
    const id = query.id || body.id;
    if (!id) {
      throw new AppError(
        "Account id is required for DELETE /api/v1/accounts",
        400,
        "validation_error"
      );
    }
    await deleteAccount(id);
    return reply.send({ ok: true });
  });
};
