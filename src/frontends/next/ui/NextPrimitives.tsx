import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../../lib/utils";

type ButtonTone = "primary" | "secondary" | "quiet" | "danger";

type NextButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
};

/** A single interaction vocabulary for full-label actions in the next frontend. */
export const NextButton = forwardRef<HTMLButtonElement, NextButtonProps>(
  ({ className, tone = "secondary", type = "button", ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={cn("next-button", className)}
      data-tone={tone}
    />
  ),
);
NextButton.displayName = "NextButton";

type NextIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "quiet" | "danger";
};

/** Icon-only controls share focus, press and disabled behavior with actions. */
export const NextIconButton = forwardRef<
  HTMLButtonElement,
  NextIconButtonProps
>(({ className, tone = "quiet", type = "button", ...props }, ref) => (
  <button
    {...props}
    ref={ref}
    type={type}
    className={cn("next-icon-button", className)}
    data-tone={tone}
  />
));
NextIconButton.displayName = "NextIconButton";

export function NextSurface({
  className,
  children,
  tone = "panel",
  ...props
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: "panel" | "subtle" | "floating";
}) {
  return (
    <section
      {...props}
      className={cn("next-surface", className)}
      data-tone={tone}
    >
      {children}
    </section>
  );
}

export function NextSection({
  className,
  title,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { title: ReactNode; children: ReactNode }) {
  return (
    <section {...props} className={cn("next-section", className)}>
      <h2 className="next-section-title">{title}</h2>
      {children}
    </section>
  );
}

export function NextSettingRow({
  icon,
  title,
  description,
  children,
  stacked = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn("next-setting-row", stacked && "next-setting-row-stacked")}
    >
      <span className="next-setting-icon" aria-hidden="true">
        {icon}
      </span>
      <div className="next-setting-label">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="next-setting-control">{children}</div>
    </div>
  );
}

export function NextEmptyState({
  className,
  icon,
  title,
  description,
  action,
}: {
  className?: string;
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cn("next-empty-state", className)}>
      <div className="next-empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
