import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "./cn";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  message: string;
  type: ToastType;
}

const TONES: Record<ToastType, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-red-200 bg-red-50 text-red-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600" />,
  error: <AlertCircle className="h-4 w-4 text-red-600" />,
  info: <Info className="h-4 w-4 text-blue-600" />,
};

export interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps): React.JSX.Element | null {
  if (!toast) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[9999] w-full max-w-sm"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg",
          TONES[toast.type]
        )}
      >
        <span className="mt-0.5 flex-none">{ICONS[toast.type]}</span>
        <p className="min-w-0 flex-1 text-sm font-medium">{toast.message}</p>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 flex h-6 w-6 flex-none items-center justify-center rounded-md opacity-60 transition-opacity hover:opacity-100"
          aria-label="Fechar aviso"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function useToast(duration = 5000): {
  toast: ToastMessage | null;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: () => void;
} {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "success") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, duration);
    },
    [duration]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast, dismissToast };
}
