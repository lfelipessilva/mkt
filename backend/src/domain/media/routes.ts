import fs from "node:fs";
import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { AppError } from "../../shared/errors.js";
import {
  safeResolveMediaPath,
  contentTypeForPath,
  getMediaRoot,
  validCategoriesForScope,
  MEDIA_SCOPES,
  type MediaCategory,
} from "./paths.js";
import {
  listMediaAssets,
  upsertMediaAsset,
  deleteMediaAsset,
  extractImageDimensions,
} from "./store.js";
import {
  GetMediaQuerySchema,
  DeleteMediaSchema,
  GetMediaFileQuerySchema,
  MediaCategorySchema,
} from "./schemas.js";
import { ContentScopeSchema, type ContentScope } from "../archetypes/schemas.js";

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/media/file?path=
  app.get("/file", async (request, reply) => {
    const parsed = GetMediaFileQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError("Media path parameter is required", 400, "invalid_path");
    }

    const resolved = safeResolveMediaPath(parsed.data.path);

    if (!fs.existsSync(resolved)) {
      throw new AppError(`File not found: '${parsed.data.path}'`, 404, "not_found");
    }

    const contentType = contentTypeForPath(resolved);
    const stream = fs.createReadStream(resolved);
    return reply.type(contentType).send(stream);
  });

  // GET /api/v1/media?scope=&category=
  app.get("/", async (request, reply) => {
    const parsed = GetMediaQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    const assets = await listMediaAssets({
      scope: parsed.data.scope,
      category: parsed.data.category,
      active: parsed.data.active,
    });

    return reply.send(assets);
  });

  // POST /api/v1/media/upload (multipart)
  app.post("/upload", async (request, reply) => {
    if (!request.isMultipart()) {
      throw new AppError("Content-Type must be multipart/form-data", 400, "bad_request");
    }

    const parts = request.parts();
    let fileBuffer: Buffer | null = null;
    let originalFilename = "";
    let scopeStr: string | undefined = (request.query as { scope?: string })?.scope;
    let categoryStr: string | undefined = (request.query as { category?: string })?.category;

    for await (const part of parts) {
      if (part.type === "file") {
        originalFilename = part.filename;
        fileBuffer = await part.toBuffer();
      } else {
        if (part.fieldname === "scope") {
          scopeStr = part.value as string;
        } else if (part.fieldname === "category") {
          categoryStr = part.value as string;
        }
      }
    }

    if (!fileBuffer || !originalFilename) {
      throw new AppError("Image file is required for upload", 400, "validation_error");
    }

    // Validate scope
    const scopeParsed = ContentScopeSchema.safeParse(scopeStr);
    if (!scopeParsed.success) {
      throw new AppError(
        `Invalid or missing scope: '${scopeStr}'. Allowed: ${MEDIA_SCOPES.join(", ")}`,
        400,
        "validation_error"
      );
    }
    const scope = scopeParsed.data;

    // Validate category
    const categoryParsed = MediaCategorySchema.safeParse(categoryStr);
    if (!categoryParsed.success) {
      throw new AppError(
        `Invalid or missing category: '${categoryStr}'`,
        400,
        "validation_error"
      );
    }
    const category = categoryParsed.data;

    // Enforce category belongs to the valid categories for this scope
    const validCategories = validCategoriesForScope(scope);
    if (!validCategories.includes(category)) {
      throw new AppError(
        `Category '${category}' is not valid for scope '${scope}'. Allowed: ${validCategories.join(", ")}`,
        400,
        "validation_error"
      );
    }

    // Write file under scopeToDir(scope)/category/
    const mediaRoot = getMediaRoot();
    const sanitizedFilename = path.basename(originalFilename);
    const targetDir = path.join(mediaRoot, scope, category);
    fs.mkdirSync(targetDir, { recursive: true });

    const targetFilePath = path.join(targetDir, sanitizedFilename);
    fs.writeFileSync(targetFilePath, fileBuffer);

    // Parse image dimensions
    const dims = extractImageDimensions(fileBuffer);
    const storagePath = path.posix.join("media", scope, category, sanitizedFilename);

    // Upsert into DB
    const asset = await upsertMediaAsset({
      scope,
      category,
      storage_path: storagePath,
      filename: sanitizedFilename,
      byte_size: fileBuffer.length,
      width: dims.width,
      height: dims.height,
      active: true,
    });

    return reply.code(201).send(asset);
  });

  // DELETE /api/v1/media
  app.delete("/", async (request, reply) => {
    const parsed = DeleteMediaSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", "),
        400,
        "validation_error"
      );
    }

    await deleteMediaAsset(parsed.data.storage_path);
    return reply.send({ ok: true, deleted: parsed.data.storage_path });
  });
};
