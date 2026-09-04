import { Children, isValidElement, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import {
  Select as ShadcnSelect,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "./select";
import { Input as ShadcnInput } from "./input";
import { Textarea as ShadcnTextarea } from "./textarea";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <ShadcnInput
      {...props}
      className={cn(
        "h-10 w-full rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface)] px-3 text-sm text-[var(--palette-text)] shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-[var(--palette-text-subtle)] hover:border-[var(--palette-border-strong)] focus:border-[var(--palette-primary)] focus:ring-[3px] focus:ring-[var(--palette-focus-ring)]",
        props.className,
      )}
    />
  );
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <ShadcnTextarea
      {...props}
      className={cn(
        "w-full resize-none rounded-md border border-[var(--palette-border)] bg-[var(--palette-surface)] px-3 py-2 text-sm leading-6 text-[var(--palette-text)] shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-[var(--palette-text-subtle)] hover:border-[var(--palette-border-strong)] focus:border-[var(--palette-primary)] focus:ring-[3px] focus:ring-[var(--palette-focus-ring)]",
        props.className,
      )}
    />
  );
}
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-xs font-medium text-[var(--palette-text-muted)]">
      {children}
    </label>
  );
}
type SelectOption = { value: string; label: string; group?: string };
const emptyValue = "__lectio_empty_value__";

function readOptions(children: React.ReactNode, group?: string): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const props = child.props as { value?: string | number; children?: React.ReactNode };
      options.push({
        value: String(props.value ?? ""),
        label: String(props.children ?? ""),
        group,
      });
    } else if (child.type === "optgroup") {
      const props = child.props as { label?: string; children?: React.ReactNode };
      options.push(...readOptions(props.children, props.label));
    }
  });
  return options;
}

/**
 * A compatibility adapter: existing feature code can keep native <option>
 * children and onChange handlers while rendering the official shadcn/Radix
 * select popover instead of the Windows-native dropdown.
 */
export function Select({
  className,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
}: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = readOptions(children);
  const actualValue = String(value ?? defaultValue ?? "");
  const radixValue = actualValue || emptyValue;
  const groups = Array.from(new Set(options.map((option) => option.group)));
  return (
    <ShadcnSelect
      value={radixValue}
      disabled={disabled}
      onValueChange={(nextValue) => {
        const next = nextValue === emptyValue ? "" : nextValue;
        onChange?.({ target: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger className={cn("h-10 w-full", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {groups.map((group) => {
          const items = options.filter((option) => option.group === group);
          return (
            <SelectGroup key={group ?? "ungrouped"}>
              {group && <SelectLabel>{group}</SelectLabel>}
              {items.map((option) => (
                <SelectItem
                  key={`${group ?? ""}-${option.value}`}
                  value={option.value || emptyValue}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </ShadcnSelect>
  );
}
