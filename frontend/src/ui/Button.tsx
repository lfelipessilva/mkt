import React from "react";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "danger-outline"
  | "link";

export type ButtonSize = "sm" | "md" | "icon" | "icon-sm";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  isLoading?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-500",
  secondary:
    "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-slate-400",
  outline:
    "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 focus-visible:ring-slate-400",
  ghost:
    "text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-400",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 focus-visible:ring-red-500",
  "danger-outline":
    "border border-red-200 bg-white text-red-600 hover:border-red-300 hover:bg-red-50 focus-visible:ring-red-400",
  link: "h-auto p-0 text-blue-600 hover:text-blue-700 hover:underline underline-offset-4 focus-visible:ring-blue-500",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-9 gap-2 rounded-lg px-4 text-sm",
  icon: "h-9 w-9 rounded-lg",
  "icon-sm": "h-7 w-7 rounded-md",
};

export function Button({
  variant = "secondary",
  size = "md",
  block = false,
  isLoading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading && <Spinner size="sm" />}
      {children}
    </button>
  );
}
