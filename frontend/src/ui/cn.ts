export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined;

/**
 * Tiny class-name joiner. Keeps the UI kit dependency-free while still making
 * conditional Tailwind classes readable at the call site.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
