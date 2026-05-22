import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AuthShellProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
  maxWidth?: "md" | "lg";
  footer?: ReactNode;
  /** e.g. `/atomo12.webm` — plays on the left hero panel (large screens). */
  heroVideoSrc?: string;
  /** Keep login/register on light theme when dashboard is in dark mode. */
  forceLight?: boolean;
}

/** Centered auth / onboarding card with brand panel on large screens. */
export function AuthShell({
  title,
  description,
  icon,
  children,
  maxWidth = "md",
  footer,
  heroVideoSrc,
  forceLight = false,
}: AuthShellProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-screen flex-col lg:flex-row",
        forceLight && "auth-theme-light",
      )}
    >
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r border-border/60 bg-sidebar text-sidebar-foreground lg:flex">
        {heroVideoSrc ? (
          <>
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={heroVideoSrc}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sidebar/92 via-sidebar/75 to-sidebar/55"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-sidebar via-transparent to-sidebar/40"
              aria-hidden
            />
          </>
        ) : null}

        <div className="relative z-10 flex flex-1 flex-col justify-between p-10">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-sidebar-foreground/80">Atomo</p>
            <h1 className="mt-6 max-w-md text-3xl font-semibold leading-tight tracking-tight drop-shadow-sm">
              Edge intelligence for your processing unit
            </h1>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-sidebar-foreground/85">
              Register devices, run AI models on cameras, and monitor detections from one dashboard.
            </p>
          </div>
          <p className="font-mono text-xs text-sidebar-foreground/60">Atomo Processing Unit · v2.1</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        {heroVideoSrc ? (
          <div className="relative mb-8 h-40 w-full max-w-md overflow-hidden rounded-2xl border border-border/60 shadow-elevated lg:hidden">
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={heroVideoSrc}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden
            />
            <div className="absolute inset-0 bg-gradient-to-t from-sidebar/90 via-sidebar/30 to-transparent" aria-hidden />
            <p className="absolute bottom-3 left-4 text-xs font-medium uppercase tracking-widest text-sidebar-foreground/90">
              Atomo Processing Unit
            </p>
          </div>
        ) : null}
        <div
          className={cn(
            "w-full opacity-0 animate-scale-in",
            maxWidth === "lg" ? "max-w-2xl" : "max-w-md",
          )}
        >
          <div className="surface-card rounded-2xl p-8 shadow-elevated md:p-10">
            <div className="mb-8 flex items-start gap-4">
              {icon ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                  {icon}
                </div>
              ) : null}
              <div className="min-w-0">
                <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
                {description ? <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
              </div>
            </div>
            {children}
          </div>
          {footer ? <div className="mt-6 text-center">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}
