import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md";
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Work in flight: shows a spinner, announces busy and blocks a second activation. */
  busy?: boolean;
};

export function Button({ variant = "secondary", size = "md", leading, trailing, busy = false, disabled, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>
    {leading && <span className="ui-button__icon" aria-hidden="true">{leading}</span>}
    <span>{children}</span>
    {trailing && <span className="ui-button__icon" aria-hidden="true">{trailing}</span>}
  </button>;
}
