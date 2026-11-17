import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { Api } from "grammy";
import { getPool } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors.js";
import {
  isSiloEnabled,
  downloadCarouselFromSilo,
} from "../../shared/storage/silo.js";
import {
  sendCarouselAlbum,
  type SendCarouselAlbumOptions,
} from "../../pipeline/telegram.js";
import { getCarouselRun, updateCarouselRun } from "../runs/store.js";
import { getAccount } from "../accounts/store.js";
import { getSocialPublisherProvider } from "../social/factory.js";
import { resolveCarouselSlidePublicUrls } from "../social/urls.js";
import type { SocialPublisherProvider } from "../social/types.js";
import { safeResolveMediaPath } from "../media/paths.js";
import type {
  DispatchChannel,
  DispatchEvent,
  DispatchResult,
} from "./schemas.js";

export type SendTelegramAlbumFn = (
  opts: SendCarouselAlbumOptions
) => Promise<void>;

export type CarouselBytesLoader = (storagePath: string) => Promise<Buffer>;

let customTelegramSender: SendTelegramAlbumFn | null = null;
let customFetchFn: typeof fetch | null = null;
let customSocialPublisherProvider: SocialPublisherProvider | null = null;
let customCarouselLoader: CarouselBytesLoader | null = null;

export function setTelegramSender(fn: SendTelegramAlbumFn | null): void {
  customTelegramSender = fn;
}

export function setFetchFn(fn: typeof fetch | null): void {
  customFetchFn = fn;
}

export function setSocialPublisherProvider(provider: SocialPublisherProvider | null): void {
  customSocialPublisherProvider = provider;
}

export function setCarouselBytesLoader(fn: CarouselBytesLoader | null): void {
  customCarouselLoader = fn;
}

export interface DispatchCarouselRunOptions {
  runId: string;
  channel: DispatchChannel;
  triggeredBy?: string;
  pool?: Pool;
  telegramApi?: Api;
  telegramToken?: string;
  telegramChatId?: string | number;
  sendTelegramAlbum?: SendTelegramAlbumFn;
  webhookUrl?: string;
  fetchFn?: typeof fetch;
  socialPublisherProvider?: SocialPublisherProvider;
  carouselBytesLoader?: CarouselBytesLoader;
}

function mapDispatchEventRow(row: any): DispatchEvent {
  return {
    id: row.id,
    run_id: row.run_id,
    channel: row.channel,
    status: row.status,
    triggered_by: row.triggered_by,
    request_payload: row.request_payload,
    response_payload: row.response_payload,
    sent_at: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    created_at: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString(),
  };
}

export async function getDispatchEvents(
  runId: string,
  poolInstance?: Pool
): Promise<DispatchEvent[]> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT id, run_id, channel, status, triggered_by, request_payload,
            response_payload, sent_at, created_at
     FROM dispatch_events
     WHERE run_id = $1
     ORDER BY created_at DESC`,
    [runId]
  );
  return res.rows.map(mapDispatchEventRow);
}

export async function getDispatchEvent(
  id: string,
  poolInstance?: Pool
): Promise<DispatchEvent | null> {
  const p = poolInstance || getPool();
  const res = await p.query(
    `SELECT id, run_id, channel, status, triggered_by, request_payload,
            response_payload, sent_at, created_at
     FROM dispatch_events
     WHERE id = $1`,
    [id]
  );
  if (!res.rows[0]) return null;
  return mapDispatchEventRow(res.rows[0]);
}

export async function dispatchCarouselRun(
  options: DispatchCarouselRunOptions
): Promise<DispatchResult> {
  const p = options.pool || getPool();
  const triggeredBy = options.triggeredBy || "manual";

  // 1. Fetch run
  const run = await getCarouselRun(options.runId, p);
  if (!run) {
    throw new AppError(`Run '${options.runId}' not found`, 404, "not_found");
  }

  // 2. Extract and sort slides
  const slides = (run.slides || []).slice().sort((a, b) => a.position - b.position);
  if (slides.length === 0) {
    throw new AppError("Run has no slides to dispatch", 400, "no_slides");
  }

  // Ensure each slide is downloaded locally to temp before Telegram InputFile / dispatch
  const loader = options.carouselBytesLoader || customCarouselLoader;
  const slidePaths: string[] = [];

  for (const s of slides) {
    let localPath: string;
    try {
      localPath = safeResolveMediaPath(s.storage_path);
    } catch {
      localPath = s.storage_path;
    }

    if (!fs.existsSync(localPath)) {
      let fileBuf: Buffer | null = null;
      if (loader) {
        fileBuf = await loader(s.storage_path);
      } else if (isSiloEnabled()) {
        try {
          fileBuf = await downloadCarouselFromSilo(s.storage_path);
        } catch (err: any) {
          throw new AppError(
            `Failed to download slide '${s.storage_path}' from Silo: ${err?.message || String(err)}`,
            500,
            "silo_download_failed"
          );
        }
      }

      if (fileBuf) {
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, fileBuf);
      } else {
        throw new AppError(
          `Slide file '${s.storage_path}' not found on disk and Silo download unavailable`,
          404,
          "slide_not_found"
        );
      }
    }

    slidePaths.push(localPath);
  }

  // 3. Channel-specific validation & payload preparation
  let chatId: string | number | undefined;
  let token: string | undefined;
  let webhookUrl: string | undefined;
  let requestPayload: any;

  if (options.channel === "telegram") {
    chatId = options.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    token = options.telegramToken || process.env.TELEGRAM_BOT_TOKEN;

    if (!chatId || (!token && !options.telegramApi && !customTelegramSender)) {
      throw new AppError(
        "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured for telegram dispatch",
        400,
        "config_error"
      );
    }

    requestPayload = {
      chat_id: chatId,
      account_id: run.account_id,
      slide_paths: slidePaths,
      legenda: run.legenda,
    };
  } else if (options.channel === "api") {
    webhookUrl = options.webhookUrl || process.env.DISPATCH_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new AppError(
        "DISPATCH_WEBHOOK_URL environment variable is not configured",
        400,
        "config_error"
      );
    }

    requestPayload = {
      run_id: run.id,
      account_id: run.account_id,
      slide_paths: slidePaths,
      legenda: run.legenda,
    };
  } else if (options.channel === "zernio" || options.channel === "social") {
    const account = await getAccount(run.account_id, p);
    if (!account) {
      throw new AppError(`Account '${run.account_id}' not found`, 404, "not_found");
    }
    if (!account.external_account_id) {
      throw new AppError(
        `Account '${run.account_id}' does not have an external_account_id configured for social dispatch`,
        400,
        "config_error"
      );
    }

    const imageUrls = await resolveCarouselSlidePublicUrls(run);

    requestPayload = {
      run_id: run.id,
      account_id: run.account_id,
      external_account_id: account.external_account_id,
      image_urls: imageUrls,
      legenda: run.legenda,
      channel: options.channel,
    };
  } else {
    throw new AppError(
      `Unsupported dispatch channel: ${options.channel}`,
      400,
      "validation_error"
    );
  }

  // 4. Create pending dispatch_event row
  const insertRes = await p.query(
    `INSERT INTO dispatch_events (run_id, channel, status, triggered_by, request_payload)
     VALUES ($1, $2, 'pending', $3, $4)
     RETURNING id, run_id, channel, status, triggered_by, request_payload,
               response_payload, sent_at, created_at`,
    [run.id, options.channel, triggeredBy, JSON.stringify(requestPayload)]
  );
  const eventId = insertRes.rows[0].id;

  // 5. Execute channel send
  try {
    let responsePayload: any = null;
    let publishedImmediately = false;

    if (options.channel === "telegram") {
      const sender =
        options.sendTelegramAlbum || customTelegramSender || sendCarouselAlbum;
      const api =
        options.telegramApi || (token ? new Api(token) : undefined);

      await sender({
        api: api as any,
        chatId: chatId!,
        accountId: run.account_id,
        imagePaths: slidePaths,
        legenda: run.legenda,
      });

      responsePayload = { ok: true };
    } else if (options.channel === "api") {
      const fetcher = options.fetchFn || customFetchFn || fetch;
      const res = await fetcher(webhookUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id: run.id,
          runId: run.id,
          account_id: run.account_id,
          accountId: run.account_id,
          slide_paths: slidePaths,
          slidePaths: slidePaths,
          slides: slidePaths,
          legenda: run.legenda,
          tema: run.tema,
        }),
      });

      const responseText = await res.text();
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        parsedBody = responseText;
      }

      if (!res.ok) {
        throw new Error(
          `Webhook returned status ${res.status}: ${responseText}`
        );
      }

      responsePayload = {
        status: res.status,
        body: parsedBody,
      };
    } else if (options.channel === "zernio" || options.channel === "social") {
      const provider =
        options.socialPublisherProvider ||
        customSocialPublisherProvider ||
        getSocialPublisherProvider();

      const publishRes = await provider.publishPost({
        internalPostId: run.id,
        externalAccountId: requestPayload.external_account_id,
        caption: run.legenda || "",
        media: {
          type: "carousel",
          imageUrls: requestPayload.image_urls,
        },
        publishMode: "immediate",
      });

      responsePayload = publishRes;
      publishedImmediately = publishRes.status === "published";

      const providerName = "zernio";

      await p.query(
        `INSERT INTO tiktok_posts (
          run_id,
          tracking_mode,
          provider,
          external_post_id,
          publish_status,
          raw_response,
          published_at,
          updated_at
        )
        VALUES ($1, 'api', $2, $3, $4, $5, $6, NOW())
        ON CONFLICT (run_id) DO UPDATE SET
          tracking_mode = 'api',
          provider = EXCLUDED.provider,
          external_post_id = EXCLUDED.external_post_id,
          publish_status = EXCLUDED.publish_status,
          raw_response = EXCLUDED.raw_response,
          published_at = COALESCE(EXCLUDED.published_at, tiktok_posts.published_at),
          updated_at = NOW()`,
        [
          run.id,
          providerName,
          publishRes.externalPostId,
          publishRes.status,
          JSON.stringify(publishRes.rawResponse || {}),
          publishRes.publishedAt ? new Date(publishRes.publishedAt) : (publishRes.status === "published" ? new Date() : null),
        ]
      );

      if (publishRes.status === "failed") {
        throw new AppError(
          publishRes.errorMessage || "Social publisher returned failed status",
          502,
          "dispatch_failed"
        );
      }
    }

    // 6. On success: update dispatch_event to 'sent'
    const updateEventRes = await p.query(
      `UPDATE dispatch_events
       SET status = 'sent', sent_at = NOW(), response_payload = $1
       WHERE id = $2
       RETURNING id, run_id, channel, status, triggered_by, request_payload,
                 response_payload, sent_at, created_at`,
      [JSON.stringify(responsePayload), eventId]
    );

    // 7. Update run status to 'dispatched' (or 'published' when the provider
    //    confirms the post is already live, so the UI stops asking for manual publish).
    await updateCarouselRun(
      run.id,
      { status: publishedImmediately ? "published" : "dispatched" },
      p
    );
    const updatedRun = await getCarouselRun(run.id, p);

    return {
      event: mapDispatchEventRow(updateEventRes.rows[0]),
      run: updatedRun!,
    };
  } catch (error: any) {
    // On failure: update dispatch_event to 'failed'
    console.error("[dispatchCarouselRun] failed:", error?.stack || error);
    const errorPayload = {
      error: error instanceof Error ? error.message : String(error),
    };

    if (options.channel === "zernio" || options.channel === "social") {
      await updateCarouselRun(
        run.id,
        {
          status: "failed",
          error_message: errorPayload.error,
        },
        p
      ).catch((updateErr) => {
        console.error("[dispatchCarouselRun] failed to mark run failed:", updateErr);
      });
    }

    await p.query(
      `UPDATE dispatch_events
       SET status = 'failed', response_payload = $1
       WHERE id = $2`,
      [JSON.stringify(errorPayload), eventId]
    );

    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      `Dispatch failed: ${error.message || String(error)}`,
      502,
      "dispatch_failed"
    );
  }
}
