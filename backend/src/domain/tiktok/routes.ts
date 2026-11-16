import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import {
  UpsertTikTokPostSchema,
  TikTokPerformanceQuerySchema,
} from "./schemas.js";
import {
  upsertTikTokPost,
  getTikTokPostByRunId,
  listTikTokPerformance,
  runTikTokSyncStub,
  getLatestTikTokSyncRun,
} from "./store.js";

export const tiktokRoutes: FastifyPluginAsync = async (app) => {
  // PUT /api/v1/tiktok/posts/:runId
  app.put("/posts/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const parsed = UpsertTikTokPostSchema.safeParse(request.body || {});
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const { post, run } = await upsertTikTokPost(runId, parsed.data);
    return reply.code(200).send({
      ...post,
      post,
      run,
      ok: true,
    });
  });

  // GET /api/v1/tiktok/posts/:runId
  app.get("/posts/:runId", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const post = await getTikTokPostByRunId(runId);
    if (!post) {
      throw new AppError(`TikTok post for run '${runId}' not found`, 404, "not_found");
    }
    return reply.send(post);
  });

  // GET /api/v1/tiktok/performance?accountId=&sort=views
  app.get("/performance", async (request, reply) => {
    const parsed = TikTokPerformanceQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const performance = await listTikTokPerformance(parsed.data);
    return reply.send(performance);
  });

  // POST /api/v1/tiktok/sync
  app.post("/sync", async (_request, reply) => {
    const result = await runTikTokSyncStub();
    return reply.send(result);
  });

  // GET /api/v1/tiktok/sync/latest
  app.get("/sync/latest", async (_request, reply) => {
    const latest = await getLatestTikTokSyncRun();
    return reply.send({ latest });
  });
};
