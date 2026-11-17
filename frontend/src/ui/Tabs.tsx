import React from "react";
import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: React.ReactNode;
  suffix?: React.ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  variant?: "segmented" | "pills";
  className?: string;
}

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "segmented",
  className,
}: TabsProps): React.JSX.Element {
  const isPills = variant === "pills";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        isPills
          ? "flex flex-wrap items-center gap-2"
          : "inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm",
        className
      )}
    >
      {items.map((item) => {
        const isActive = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              isPills
                ? "rounded-lg border px-3 py-1.5"
                : "rounded-lg px-3 py-1.5",
              isPills
                ? isActive
                  ? "border-blue-200 bg-blue-50 text-blue-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                : isActive
                ? "bg-blue-600 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            )}
          >
            {item.label}
            {item.suffix}
          </button>
        );
      })}
    </div>
  );
}
