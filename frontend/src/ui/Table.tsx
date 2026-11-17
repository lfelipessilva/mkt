import React from "react";
import { cn } from "./cn";

export function Table({
  className,
  children,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>): React.JSX.Element {
  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table
        className={cn("w-full border-collapse text-left text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  );
}

export function TableHead({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>): React.JSX.Element {
  return (
    <thead className={cn("bg-slate-50", className)} {...props}>
      {children}
    </thead>
  );
}

export function TableBody(
  props: React.HTMLAttributes<HTMLTableSectionElement>
): React.JSX.Element {
  return <tbody {...props} />;
}

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  disabled?: boolean;
}

export function TableRow({
  disabled = false,
  className,
  ...props
}: TableRowProps): React.JSX.Element {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-slate-50/80",
        disabled && "opacity-60",
        className
      )}
      {...props}
    />
  );
}

export function TableHeaderCell({
  className,
  children,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      className={cn(
        "border-b border-slate-200 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({
  className,
  children,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <td
      className={cn(
        "border-b border-slate-100 px-4 py-3 align-middle text-slate-600",
        className
      )}
      {...props}
    >
      {children}
    </td>
  );
}
