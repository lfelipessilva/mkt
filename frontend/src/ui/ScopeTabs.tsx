import React from "react";
import { cn } from "./cn";
import { Tabs } from "./Tabs";

export interface ScopeOption {
  id: string;
  label: string;
  pinned?: boolean;
}

export interface ScopeTabsProps {
  label?: React.ReactNode;
  options: ScopeOption[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function ScopeTabs({
  label,
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: ScopeTabsProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:gap-4",
        className
      )}
    >
      {label && (
        <span className="flex-none text-[11px] font-bold uppercase tracking-wider text-slate-500">
          {label}
        </span>
      )}
      <Tabs
        variant="pills"
        ariaLabel={ariaLabel}
        value={value}
        onChange={onChange}
        items={options.map((option) => ({
          id: option.id,
          label: option.label,
          suffix: option.pinned ? (
            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              pinned
            </span>
          ) : undefined,
        }))}
      />
    </div>
  );
}
