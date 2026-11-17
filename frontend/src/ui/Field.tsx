import React from "react";
import { cn } from "./cn";

const CONTROL_CLASS =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500";

export interface FieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: FieldProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-slate-700"
      >
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <span className="text-xs font-medium text-red-600">{error}</span>
      ) : (
        hint && <span className="text-[11px] text-slate-500">{hint}</span>
      )}
    </div>
  );
}

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input ref={ref} className={cn(CONTROL_CLASS, className)} {...props} />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(CONTROL_CLASS, "cursor-pointer appearance-auto", className)}
      {...props}
    >
      {children}
    </select>
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL_CLASS, "min-h-[92px] resize-y", className)}
      {...props}
    />
  );
});

export interface CheckboxFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: React.ReactNode;
  description?: React.ReactNode;
}

export function CheckboxField({
  label,
  description,
  className,
  ...props
}: CheckboxFieldProps): React.JSX.Element {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 text-sm text-slate-700",
        props.disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 flex-none rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-blue-500"
        {...props}
      />
      <span className="min-w-0">
        <span className="block font-medium text-slate-700">{label}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-slate-500">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
