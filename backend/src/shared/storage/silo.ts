import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

export interface SiloConfig {
  serverUrl: string;
  accessKey: string;
  secretKey: string;
  mediaBucket: string;
  carouselsBucket: string;
  browserRedirectUrl?: string;
}

let cachedS3Client: S3Client | null = null;
let cachedConfig: SiloConfig | null = null;

export function getSiloConfig(): SiloConfig | null {
  const serverUrl = process.env.SILO_SERVER_URL;
  const accessKey = process.env.SILO_ACCESS_KEY;
  const secretKey = process.env.SILO_SECRET_KEY;

  if (!serverUrl || !accessKey || !secretKey) {
    return null;
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    accessKey,
    secretKey,
    mediaBucket: process.env.SILO_MEDIA_BUCKET || "media",
    carouselsBucket: process.env.SILO_CAROUSELS_BUCKET || "carousels",
    browserRedirectUrl: process.env.SILO_BROWSER_REDIRECT_URL,
  };
}

export function isSiloEnabled(): boolean {
  return getSiloConfig() !== null;
}

export function getSiloClient(): S3Client {
  const config = getSiloConfig();
  if (!config) {
    throw new Error("Silo is not configured (missing SILO_SERVER_URL, SILO_ACCESS_KEY, or SILO_SECRET_KEY)");
  }

  if (
    !cachedS3Client ||
    !cachedConfig ||
    cachedConfig.serverUrl !== config.serverUrl ||
    cachedConfig.accessKey !== config.accessKey ||
    cachedConfig.secretKey !== config.secretKey
  ) {
    const s3Config: S3ClientConfig = {
      endpoint: config.serverUrl,
      region: "us-east-1",
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      forcePathStyle: true,
    };
    cachedS3Client = new S3Client(s3Config);
    cachedConfig = config;
  }

  return cachedS3Client;
}

/**
 * Upload a buffer or stream to Silo S3 bucket.
 */
export async function uploadToSilo(
  bucket: string,
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string
): Promise<void> {
  const s3 = getSiloClient();
  const cleanKey = key.replace(/^\/+/, "");
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Download an object from Silo S3 as Buffer.
 */
export async function downloadFromSilo(bucket: string, key: string): Promise<Buffer> {
  const s3 = getSiloClient();
  const cleanKey = key.replace(/^\/+/, "");
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    })
  );

  if (!response.Body) {
    throw new Error(`Empty body for object '${cleanKey}' in bucket '${bucket}'`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/**
 * Get object stream from Silo S3 for streaming to client.
 */
export async function getSiloObjectStream(
  bucket: string,
  key: string
): Promise<{
  stream: Readable;
  contentType?: string;
  contentLength?: number;
}> {
  const s3 = getSiloClient();
  const cleanKey = key.replace(/^\/+/, "");
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    })
  );

  if (!response.Body) {
    throw new Error(`Empty body for object '${cleanKey}' in bucket '${bucket}'`);
  }

  const stream = response.Body as unknown as Readable;
  return {
    stream,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Delete an object from Silo S3.
 */
export async function deleteFromSilo(bucket: string, key: string): Promise<void> {
  const s3 = getSiloClient();
  const cleanKey = key.replace(/^\/+/, "");
  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    })
  );
}

/**
 * Check if an object exists in Silo S3.
 */
export async function siloObjectExists(bucket: string, key: string): Promise<boolean> {
  try {
    const s3 = getSiloClient();
    const cleanKey = key.replace(/^\/+/, "");
    await s3.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: cleanKey,
      })
    );
    return true;
  } catch (err: any) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * List object keys with optional prefix.
 */
export async function listSiloObjects(bucket: string, prefix?: string): Promise<string[]> {
  const s3 = getSiloClient();
  const cleanPrefix = prefix ? prefix.replace(/^\/+/, "") : undefined;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: cleanPrefix,
        ContinuationToken: continuationToken,
      })
    );

    if (response.Contents) {
      for (const item of response.Contents) {
        if (item.Key) keys.push(item.Key);
      }
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return keys;
}

// Convenient helpers for Media bucket
export async function uploadMediaToSilo(
  key: string,
  body: Buffer,
  contentType?: string
): Promise<void> {
  const config = getSiloConfig();
  const bucket = config?.mediaBucket || "media";
  // Normalize key: remove leading "media/" if present so the key inside media bucket is e.g. "single_man/cover/foto.jpg"
  const normalizedKey = key.startsWith("media/") ? key.slice(6) : key;
  await uploadToSilo(bucket, normalizedKey, body, contentType);
}

export async function deleteMediaFromSilo(key: string): Promise<void> {
  const config = getSiloConfig();
  const bucket = config?.mediaBucket || "media";
  const normalizedKey = key.startsWith("media/") ? key.slice(6) : key;
  await deleteFromSilo(bucket, normalizedKey);
}

export async function getMediaStreamFromSilo(
  key: string
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  const config = getSiloConfig();
  const bucket = config?.mediaBucket || "media";
  const normalizedKey = key.startsWith("media/") ? key.slice(6) : key;
  return getSiloObjectStream(bucket, normalizedKey);
}

// Convenient helpers for Carousels bucket
export async function uploadCarouselToSilo(
  key: string,
  body: Buffer | string,
  contentType?: string
): Promise<void> {
  const config = getSiloConfig();
  const bucket = config?.carouselsBucket || "carousels";
  // Normalize key: remove leading "output/" if present
  let normalizedKey = key.replace(/^\/+/, "");
  if (normalizedKey.startsWith("output/")) {
    normalizedKey = normalizedKey.slice(7);
  }
  const bufferBody = typeof body === "string" ? Buffer.from(body, "utf-8") : body;
  await uploadToSilo(bucket, normalizedKey, bufferBody, contentType);
}

export async function getCarouselStreamFromSilo(
  key: string
): Promise<{ stream: Readable; contentType?: string; contentLength?: number }> {
  const config = getSiloConfig();
  const bucket = config?.carouselsBucket || "carousels";
  let normalizedKey = key.replace(/^\/+/, "");
  if (normalizedKey.startsWith("output/")) {
    normalizedKey = normalizedKey.slice(7);
  }
  return getSiloObjectStream(bucket, normalizedKey);
}
