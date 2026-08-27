import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "border-amber/70 bg-amber text-[#17120a] shadow-control hover:bg-[#f2bb5d] hover:shadow-[0_12px_34px_rgb(234_176_79_/_0.16)]",
  secondary: "border-line bg-white/[0.025] text-ink shadow-control hover:border-white/20 hover:bg-white/[0.055]",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-white/[0.045] hover:text-ink",
  danger: "border-danger/20 bg-danger/[0.035] text-danger hover:border-danger/35 hover:bg-danger/[0.07]",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 gap-2 px-3 text-xs",
  md: "min-h-11 gap-2 px-4 text-[13px]",
  icon: "size-10 justify-center p-0",
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
        "inline-flex shrink-0 items-center justify-center rounded-control border font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-morrow active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      type={type}
      {...props}
    />
  );
}
