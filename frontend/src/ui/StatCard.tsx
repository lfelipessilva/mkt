import React from "react";
import { cn } from "./cn";

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  highlight?: boolean;
  tone?: "blue" | "rose" | "emerald" | "slate";
  className?: string;
}

const TONES = {
  blue: "bg-blue-50 text-blue-600",
  rose: "bg-rose-50 text-rose-600",
  emerald: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-500",
} as const;

export function StatCard({
  label,
  value,
  icon,
  hint,
  highlight = false,
  tone = "slate",
  className,
}: StatCardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-white p-4 shadow-sm",
        highlight
          ? "border-blue-200 bg-gradient-to-br from-blue-50/80 to-white"
          : "border-slate-200",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg",
              TONES[tone]
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <span
        className={cn(
          "text-2xl font-bold leading-none tracking-tight",
          highlight ? "text-blue-900" : "text-slate-900"
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
    </div>
  );
}
