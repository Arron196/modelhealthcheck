import type {ComponentPropsWithoutRef, ReactNode} from "react";
import Link from "next/link";
import {AlertTriangle, CheckCircle2, CornerUpRight} from "lucide-react";

import {buttonVariants} from "@/components/ui/button";
import {cn} from "@/lib/utils";

export function CornerPlus({className}: {className?: string}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className={cn("absolute h-4 w-4 text-muted-foreground/40", className)}
    >
      <line x1="12" y1="0" x2="12" y2="24" />
      <line x1="0" y1="12" x2="24" y2="12" />
    </svg>
  );
}

export function AdminPageIntro(props: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-[2rem] border border-border/40 bg-background/50 px-5 py-6 shadow-sm backdrop-blur-md sm:px-8 sm:py-8 sm:mt-4">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(14,165,233,0.08),transparent_40%),radial-gradient(circle_at_80%_100%,rgba(16,185,129,0.06),transparent_40%)]"
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between relative z-10">
        <div className="relative max-w-3xl space-y-3">
          <div className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-foreground to-foreground/70">
              {props.title}
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground/80 sm:text-base">
              {props.description}
            </p>
          </div>
        </div>

        {props.actions ? <div className="flex flex-wrap gap-3">{props.actions}</div> : null}
      </div>
    </section>
  );
}

export function AdminPanel(props: {
  title: string;
  description?: string;
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rounded-[2rem] border border-border/60 bg-white/40 p-5 shadow-lg shadow-black/5 backdrop-blur-xl dark:bg-black/20 dark:shadow-black/25 sm:p-6", props.className)}>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{props.title}</h2>
          {props.description ? (
            <p className="text-sm leading-6 text-muted-foreground">{props.description}</p>
          ) : null}
        </div>
        {props.trailing ? <div className="shrink-0">{props.trailing}</div> : null}
      </div>
      {props.children}
    </section>
  );
}

export function AdminStatCard(props: {
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-[1.75rem] border border-border/60 bg-gradient-to-br from-background/90 to-background/65 p-5 shadow-md shadow-black/5 backdrop-blur-sm dark:shadow-black/20">
      <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">
        {props.label}
      </p>
      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-semibold tracking-[-0.05em] text-foreground sm:text-4xl">
            {props.value}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{props.helper}</p>
        </div>
      </div>
    </div>
  );
}

export function AdminActionLink(props: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={props.href}
      className={cn(buttonVariants({size: "lg"}), "rounded-full px-5")}
    >
      {props.children}
      <CornerUpRight className="ml-2 h-4 w-4 opacity-70" />
    </Link>
  );
}

export function AdminStatusBanner(props: {
  type: "success" | "error";
  message: string;
}) {
  const isError = props.type === "error";
  const Icon = isError ? AlertTriangle : CheckCircle2;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[1.5rem] border px-4 py-3 text-sm shadow-sm",
        isError
          ? "border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{props.message}</span>
    </div>
  );
}

export function AdminField(props: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.description ? (
        <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
      ) : null}
    </label>
  );
}

export function AdminInput(props: ComponentPropsWithoutRef<"input">) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-2xl border border-border/50 bg-background/85 px-4 py-3 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-cyan-500/35 focus:ring-2 focus:ring-cyan-500/15",
        props.className
      )}
    />
  );
}

export function AdminTextarea(props: ComponentPropsWithoutRef<"textarea">) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[130px] w-full rounded-2xl border border-border/50 bg-background/85 px-4 py-3 text-sm text-foreground shadow-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-cyan-500/35 focus:ring-2 focus:ring-cyan-500/15",
        props.className
      )}
    />
  );
}

export function AdminSelect(props: ComponentPropsWithoutRef<"select">) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-2xl border border-border/50 bg-background/85 px-4 py-3 text-sm text-foreground shadow-sm outline-none transition focus:border-cyan-500/35 focus:ring-2 focus:ring-cyan-500/15",
        props.className
      )}
    />
  );
}

export function AdminCheckbox(props: {
  name: string;
  defaultChecked?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-2xl border border-border/40 bg-background/70 px-4 py-3 text-sm shadow-sm">
      <input
        type="checkbox"
        name={props.name}
        defaultChecked={props.defaultChecked}
        className="mt-1 h-4 w-4 rounded border-border/60 text-foreground"
      />
      <span className="space-y-1">
        <span className="block font-medium text-foreground">{props.label}</span>
        {props.description ? (
          <span className="block text-xs leading-5 text-muted-foreground">{props.description}</span>
        ) : null}
      </span>
    </label>
  );
}
