import React from "react";
import { cn } from "./cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "section";
}

export function Card({
  as = "div",
  className,
  children,
  ...props
}: CardProps): React.JSX.Element {
  const Element = as;
  return (
    <Element
      className={cn(
        "rounded-xl border border-slate-200 bg-white shadow-sm",
        className
      )}
      {...props}
    >
      {children}
    </Element>
  );
}

export interface SectionCardProps extends Omit<CardProps, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  contentClassName?: string;
}

export function SectionCard({
  title,
  description,
  actions,
  icon,
  className,
  contentClassName,
  children,
  ...props
}: SectionCardProps): React.JSX.Element {
  return (
    <Card className={cn("p-5", className)} {...props}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-slate-900">
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-none flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
      {children && (
        <div className={cn("mt-4", contentClassName)}>{children}</div>
      )}
    </Card>
  );
}
