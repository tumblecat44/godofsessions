import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Surface({ className, children, ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section
      className={cn("rounded-panel border border-line-soft bg-surface/72", className)}
      {...props}
    >
      {children}
    </section>
  );
}
