import React from "react";
import { cn } from "./cn";
import type { AccountRole } from "../types";

export type BadgeTone =
  | "neutral"
  | "blue"
  | "sky"
  | "emerald"
  | "amber"
  | "red"
  | "pink"
  | "purple";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-100 text-slate-600",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  pink: "border-pink-200 bg-pink-50 text-pink-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  pill?: boolean;
}

export function Badge({
  tone = "neutral",
  pill = false,
  className,
  children,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border px-2 py-0.5 text-[11px] font-semibold",
        pill ? "rounded-full" : "rounded-md",
        TONES[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  generated: "emerald",
  completed: "emerald",
  published: "pink",
  dispatched: "blue",
  running: "blue",
  generating: "sky",
  dispatching: "sky",
  awaiting_approval: "amber",
  pending: "neutral",
  scheduled: "blue",
  queued: "amber",
  skipped: "neutral",
  failed: "red",
  error: "red",
  cancelled: "neutral",
};

export function statusTone(status: string): BadgeTone {
  return STATUS_TONES[status] ?? "neutral";
}

export interface StatusBadgeProps
  extends Omit<BadgeProps, "tone" | "children"> {
  status: string;
  label?: React.ReactNode;
}

export function StatusBadge({
  status,
  label,
  className,
  ...props
}: StatusBadgeProps): React.JSX.Element {
  return (
    <Badge
      tone={statusTone(status)}
      pill
      className={cn("uppercase tracking-wide", className)}
      {...props}
    >
      {label ?? status}
    </Badge>
  );
}

const ROLE_TONES: Record<AccountRole, BadgeTone> = {
  single_woman: "pink",
  single_man: "blue",
  couple_men: "purple",
  couple_women: "red",
};

export interface RoleBadgeProps {
  role: AccountRole;
  label: React.ReactNode;
  className?: string;
}

export function RoleBadge({
  role,
  label,
  className,
}: RoleBadgeProps): React.JSX.Element {
  return (
    <Badge tone={ROLE_TONES[role] ?? "neutral"} className={className}>
      {label}
    </Badge>
  );
}
