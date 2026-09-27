import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../../lib/utils";

export type NextSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Compact, theme-aware select shared by settings and other Next surfaces. */
export function NextSelect({
  value,
  onChange,
  options,
  label,
  disabled,
  className,
}: {
  value: string;
  onChange(value: string): void;
  options: NextSelectOption[];
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const emptyValue = "__lectio_empty_value__";
  return (
    <SelectPrimitive.Root
      value={value || emptyValue}
      onValueChange={(next) => onChange(next === emptyValue ? "" : next)}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger className={cn("next-select-trigger", className)} aria-label={label}>
        <SelectPrimitive.Value placeholder={options[0]?.label} />
        <SelectPrimitive.Icon asChild><ChevronDown aria-hidden="true" /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content className="next-select-content" position="popper" sideOffset={5} align="start">
          <SelectPrimitive.Viewport className="next-select-viewport">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value || emptyValue}
                value={option.value || emptyValue}
                disabled={option.disabled}
                className="next-select-item"
                data-has-description={Boolean(option.description)}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                {option.description && <span className="next-select-description" aria-hidden="true">{option.description}</span>}
                <SelectPrimitive.ItemIndicator className="next-select-indicator"><Check aria-hidden="true" /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

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
  id,
  icon,
  title,
  description,
  children,
  stacked = false,
}: {
  id?: string;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      id={id}
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
