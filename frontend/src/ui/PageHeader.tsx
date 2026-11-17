import React from "react";
import { cn } from "./cn";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-500 text-white shadow-sm shadow-blue-600/20">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:flex-none">
          {actions}
        </div>
      )}
    </section>
  );
}
