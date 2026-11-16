export interface PostWindow {
  id: string; // "morning" | "midday" | "evening" | custom
  start: string; // "07:00"
  end: string; // "09:00"
}

export const DEFAULT_WINDOWS: PostWindow[] = [
  { id: "morning", start: "07:00", end: "09:00" },
  { id: "midday", start: "11:30", end: "12:30" },
  { id: "evening", start: "18:00", end: "20:00" },
];

/**
 * Validates post windows shape and constraints:
 * - Must be an array of PostWindow objects
 * - start and end must match HH:mm (00:00 - 23:59)
 * - start must be strictly before end
 */
export function validatePostWindows(windows: unknown): windows is PostWindow[] {
  if (!Array.isArray(windows) || windows.length === 0) {
    throw new Error("invalid window format: windows must be a non-empty array");
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

  for (const win of windows) {
    if (!win || typeof win !== "object") {
      throw new Error("invalid window format: each window must be an object");
    }
    const { id, start, end } = win as Partial<PostWindow>;
    if (!id || typeof id !== "string" || id.trim() === "") {
      throw new Error("invalid window format: id must be a non-empty string");
    }
    if (!start || typeof start !== "string" || !timeRegex.test(start)) {
      throw new Error(`invalid time format: start "${start}" must be in HH:mm format`);
    }
    if (!end || typeof end !== "string" || !timeRegex.test(end)) {
      throw new Error(`invalid time format: end "${end}" must be in HH:mm format`);
    }

    if (start >= end) {
      throw new Error(`start must be before end: "${start}" >= "${end}"`);
    }
  }

  return true;
}

/**
 * Resolves automation timezone with priority:
 * app_settings.auto_post_timezone > env.AUTOMATION_TZ > env.TZ > America/Sao_Paulo
 */
export function resolveAutomationTimezone(
  settings?: Record<string, any> | null,
  env: NodeJS.ProcessEnv = process.env
): string {
  const fromSettings = settings?.auto_post_timezone;
  if (typeof fromSettings === "string" && fromSettings.trim() !== "") {
    return fromSettings.trim();
  }

  const fromAutomationTz = env.AUTOMATION_TZ;
  if (typeof fromAutomationTz === "string" && fromAutomationTz.trim() !== "") {
    return fromAutomationTz.trim();
  }

  const fromTz = env.TZ;
  if (typeof fromTz === "string" && fromTz.trim() !== "") {
    return fromTz.trim();
  }

  return "America/Sao_Paulo";
}

/**
 * Resolves post windows with priority:
 * app_settings.auto_post_windows > env.AUTO_POST_WINDOWS > DEFAULT_WINDOWS
 */
export function resolvePostWindows(
  settings?: Record<string, any> | null,
  env: NodeJS.ProcessEnv = process.env
): PostWindow[] {
  const parseCandidate = (val: unknown): PostWindow[] | null => {
    if (!val) return null;
    let candidate = val;
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        return null;
      }
    }
    try {
      if (validatePostWindows(candidate)) {
        return candidate;
      }
    } catch {
      return null;
    }
    return null;
  };

  const fromSettings = parseCandidate(settings?.auto_post_windows);
  if (fromSettings) return fromSettings;

  const fromEnv = parseCandidate(env.AUTO_POST_WINDOWS);
  if (fromEnv) return fromEnv;

  return DEFAULT_WINDOWS;
}

/**
 * Resolves post count per day:
 * app_settings.auto_post_count_per_day (clamp 1..6, default 3)
 */
export function resolvePostCountPerDay(
  settings?: Record<string, any> | null
): number {
  const val = settings?.auto_post_count_per_day;
  if (val === undefined || val === null) {
    return 3;
  }

  const num = typeof val === "number" ? val : parseInt(String(val), 10);
  if (isNaN(num)) {
    return 3;
  }

  return Math.min(Math.max(num, 1), 6);
}
