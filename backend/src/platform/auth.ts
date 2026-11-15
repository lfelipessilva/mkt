import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../shared/errors.js";

export const authenticateBearer = async (
  request: FastifyRequest,
  _reply?: FastifyReply
): Promise<void> => {
  const expectedToken = process.env.API_TOKEN || process.env.API_KEY || "dev-token";
  const header = request.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    throw new AppError("Missing or malformed bearer token", 401, "unauthorized");
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token || token !== expectedToken) {
    throw new AppError("Invalid bearer token", 401, "unauthorized");
  }
};
