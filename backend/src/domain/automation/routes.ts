import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import { approveBufferRun } from "./approve.js";
import { getAutomationSchedule, isValidDateString } from "./slots.js";

export const automationRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/automation/schedule?date=YYYY-MM-DD
  app.get("/schedule", async (request, reply) => {
    const { date } = request.query as { date?: string };
    if (date !== undefined) {
      if (!isValidDateString(date)) {
        throw new AppError("Invalid date format, expected YYYY-MM-DD", 400, "validation_error");
      }
    }

    const schedule = await getAutomationSchedule({ date });
    return reply.code(200).send(schedule);
  });

  // POST /api/v1/automation/runs/:runId/approve
  app.post("/runs/:runId/approve", async (request, reply) => {
    const { runId } = request.params as { runId: string };
    const result = await approveBufferRun(runId);
    return reply.code(200).send(result);
  });
};
