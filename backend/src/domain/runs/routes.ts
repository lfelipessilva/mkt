import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import {
  GenerateCarouselsBodySchema,
  ListCarouselRunsQuerySchema,
} from "./schemas.js";
import { generateBatch } from "./generate.js";
import {
  getGenerationJobProgress,
  listCarouselRuns,
  getCarouselRun,
} from "./store.js";

export const runsRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/carousels/generate
  app.post("/generate", async (request, reply) => {
    const parsed = GenerateCarouselsBodySchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const result = await generateBatch({
      accountIds: parsed.data.accountIds,
      mockCopy: parsed.data.mockCopy,
      skipRender: parsed.data.skipRender,
    });

    return reply.code(200).send({
      id: result.job.id,
      jobId: result.job.id,
      status: result.job.status,
      account_ids: result.job.account_ids,
      total: result.job.total,
      completed: result.job.completed,
      failed: result.job.failed,
      started_at: result.job.started_at,
      finished_at: result.job.finished_at,
      error_message: result.job.error_message,
      created_at: result.job.created_at,
      job: result.job,
      runs: result.runs,
    });
  });

  // GET /api/v1/carousels/jobs/:id
  app.get("/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const progress = await getGenerationJobProgress(id);
    if (!progress) {
      throw new AppError(`Generation job '${id}' not found`, 404, "not_found");
    }

    return reply.send({
      id: progress.id,
      jobId: progress.id,
      status: progress.status,
      account_ids: progress.account_ids,
      total: progress.total,
      completed: progress.completed,
      failed: progress.failed,
      started_at: progress.started_at,
      finished_at: progress.finished_at,
      error_message: progress.error_message,
      created_at: progress.created_at,
      job: progress,
      runs: progress.runs || [],
    });
  });

  // GET /api/v1/carousels/runs?accountId=&limit=&offset=
  app.get("/runs", async (request, reply) => {
    const parsed = ListCarouselRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const runs = await listCarouselRuns(parsed.data);
    return reply.send(runs);
  });

  // GET /api/v1/carousels/runs/:id
  app.get("/runs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const run = await getCarouselRun(id);
    if (!run) {
      throw new AppError(`Run '${id}' not found`, 404, "not_found");
    }

    return reply.send(run);
  });
};

export const carouselsRoutes = runsRoutes;
