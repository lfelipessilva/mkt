import React from "react";
import { cn } from "./cn";

export interface SpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  xs: "h-3 w-3 border",
  sm: "h-3.5 w-3.5 border-2",
  md: "h-5 w-5 border-2",
  lg: "h-8 w-8 border-[3px]",
} as const;

export function Spinner({ size = "md", className }: SpinnerProps): React.JSX.Element {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={cn(
        "inline-block animate-spin rounded-full border-slate-200 border-t-blue-600",
        SIZES[size],
        className
      )}
    />
  );
}
