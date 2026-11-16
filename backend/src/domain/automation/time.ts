/**
 * Time manipulation helpers using Intl.DateTimeFormat only (no external timezone libraries).
 */

/**
 * Formats a Date object into a YYYY-MM-DD string in the specified timezone.
 */
export function localDateString(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Converts a local date string (YYYY-MM-DD) and local time string (HH:mm)
 * in the specified timeZone into a UTC Date object.
 *
 * It uses Intl.DateTimeFormat to determine the timezone offset and refines it once
 * to handle edge cases around Daylight Saving Time (DST) transitions.
 */
export function zonedTimeToUtc(
  localDate: string,
  hhmm: string,
  timeZone: string
): Date {
  const [yearStr, monthStr, dayStr] = localDate.split("-");
  const [hourStr, minStr] = hhmm.split(":");

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);

  // Target local timestamp components
  const targetLocalMs = Date.UTC(year, month - 1, day, hour, min, 0, 0);

  // Initial estimate assuming UTC
  let estimateUtc = new Date(targetLocalMs);

  const getOffset = (d: Date): number => {
    // Extract formatted parts in target timezone
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const parts = dtf.formatToParts(d);
    let pY = 0,
      pM = 0,
      pD = 0,
      pH = 0,
      pMin = 0,
      pS = 0;

    for (const part of parts) {
      if (part.type === "year") pY = parseInt(part.value, 10);
      else if (part.type === "month") pM = parseInt(part.value, 10);
      else if (part.type === "day") pD = parseInt(part.value, 10);
      else if (part.type === "hour") pH = parseInt(part.value, 10);
      else if (part.type === "minute") pMin = parseInt(part.value, 10);
      else if (part.type === "second") pS = parseInt(part.value, 10);
    }

    const localMs = Date.UTC(pY, pM - 1, pD, pH, pMin, pS, 0);
    // localMs - utcMs = offsetMs
    return localMs - d.getTime();
  };

  // Step 1: calculate offset at estimate
  const offset1 = getOffset(estimateUtc);
  estimateUtc = new Date(targetLocalMs - offset1);

  // Step 2: refine offset once to handle DST switch
  const offset2 = getOffset(estimateUtc);
  return new Date(targetLocalMs - offset2);
}

/**
 * Adds (or subtracts) days to a YYYY-MM-DD date string, returning a new YYYY-MM-DD string.
 */
export function addLocalDays(localDate: string, n: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  // Use UTC to prevent any local host timezone shift
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);

  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
