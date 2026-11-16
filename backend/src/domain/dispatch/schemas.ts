import { z } from "zod";
import type { CarouselRun } from "../runs/schemas.js";

export const DispatchChannelSchema = z.enum(["api", "telegram", "buffer", "social"]);
export type DispatchChannel = z.infer<typeof DispatchChannelSchema>;

export const DispatchStatusSchema = z.enum(["pending", "sent", "failed"]);
export type DispatchStatus = z.infer<typeof DispatchStatusSchema>;

export const SendCarouselRunQuerySchema = z.object({
  channel: DispatchChannelSchema.default("telegram"),
});
export type SendCarouselRunQuery = z.infer<typeof SendCarouselRunQuerySchema>;

export interface DispatchEvent {
  id: string;
  run_id: string;
  channel: DispatchChannel;
  status: DispatchStatus;
  triggered_by: string;
  request_payload: any;
  response_payload: any;
  sent_at: string | null;
  created_at: string;
}

export interface DispatchResult {
  event: DispatchEvent;
  run: CarouselRun;
}
