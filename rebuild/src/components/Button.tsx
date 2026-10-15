import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger";
  size?: "sm" | "md";
  leading?: ReactNode;
  trailing?: ReactNode;
};

export function Button({ variant = "secondary", size = "md", leading, trailing, className = "", children, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()} {...props}>
    {leading && <span className="ui-button__icon" aria-hidden="true">{leading}</span>}
    <span>{children}</span>
    {trailing && <span className="ui-button__icon" aria-hidden="true">{trailing}</span>}
  </button>;
}
