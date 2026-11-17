import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "./cn";

export type AlertTone = "success" | "error" | "warning" | "info";

const TONES: Record<AlertTone, { wrapper: string; icon: React.ReactNode }> = {
  success: {
    wrapper: "border-emerald-200 bg-emerald-50 text-emerald-800",
    icon: <CheckCircle2 className="h-4 w-4 flex-none text-emerald-600" />,
  },
  error: {
    wrapper: "border-red-200 bg-red-50 text-red-800",
    icon: <AlertCircle className="h-4 w-4 flex-none text-red-600" />,
  },
  warning: {
    wrapper: "border-amber-200 bg-amber-50 text-amber-800",
    icon: <AlertTriangle className="h-4 w-4 flex-none text-amber-600" />,
  },
  info: {
    wrapper: "border-blue-200 bg-blue-50 text-blue-800",
    icon: <Info className="h-4 w-4 flex-none text-blue-600" />,
  },
};

export interface InlineAlertProps {
  tone?: AlertTone;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  role?: string;
}

export function InlineAlert({
  tone = "info",
  children,
  onClose,
  className,
  role,
}: InlineAlertProps): React.JSX.Element {
  return (
    <div
      role={role ?? (tone === "error" ? "alert" : "status")}
      className={cn(
        "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium",
        TONES[tone].wrapper,
        className
      )}
    >
      {TONES[tone].icon}
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100"
          aria-label="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
