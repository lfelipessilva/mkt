import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import { SendCarouselRunQuerySchema } from "./schemas.js";
import { dispatchCarouselRun } from "./service.js";

export const dispatchRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/carousels/runs/:id/send?channel=api|telegram|buffer|social
  app.post("/runs/:id/send", async (request, reply) => {
    const rawQuery = (request.query || {}) as Record<string, unknown>;
    const rawBody = (request.body || {}) as Record<string, unknown>;

    const channelInput = rawQuery.channel ?? rawBody.channel;
    const parsed = SendCarouselRunQuerySchema.safeParse(
      channelInput !== undefined ? { channel: channelInput } : {}
    );

    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const { id } = request.params as { id: string };
    const result = await dispatchCarouselRun({
      runId: id,
      channel: parsed.data.channel,
    });

    return reply.code(200).send({
      ok: true,
      id: result.event.id,
      status: result.event.status,
      event: result.event,
      run: result.run,
    });
  });
};
