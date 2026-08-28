import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "border-amber/70 bg-amber text-[#17120a] hover:bg-[#f2bb5d]",
  secondary: "border-line bg-white/[0.025] text-ink hover:border-white/20 hover:bg-white/[0.055]",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-white/[0.045] hover:text-ink",
  danger: "border-danger/20 bg-danger/[0.035] text-danger hover:border-danger/35 hover:bg-danger/[0.07]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-7 gap-1.5 px-2.5 text-[12px]",
  md: "min-h-8 gap-1.5 px-3 text-[13px]",
  icon: "size-8 justify-center p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

export function Button({ className, variant = "secondary", size = "md", type = "button", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-control border font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-morrow active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
