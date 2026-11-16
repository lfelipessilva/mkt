import type { FastifyPluginAsync } from "fastify";
import { approveBufferRun } from "./approve.js";

export const automationRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/automation/runs/:runId/approve
  app.post("/runs/:runId/approve", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const result = await approveBufferRun(runId);
    return reply.code(200).send(result);
  });
};
