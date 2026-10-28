import type { ReactNode } from 'react';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Toggle } from '@base-ui/react/toggle';

export interface SegmentOption<T extends string> {
  id: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

/**
 * Single choice on Base UI ToggleGroup: a named group, aria-pressed items and arrow-key roving focus.
 * Pressing the selected item keeps it selected, so a setting never becomes empty.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className, itemClassName, disabled }: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className: string;
  itemClassName: (active: boolean, option: SegmentOption<T>) => string;
  disabled?: boolean;
}) {
  return <ToggleGroup
    aria-label={label}
    className={className}
    disabled={disabled}
    value={[encode(value)]}
    onValueChange={(next, details) => {
      if (!next.length) { details.cancel(); return; }
      onChange(decode<T>(next[0]));
    }}
  >
    {options.map((option) => <Toggle
      key={option.id}
      value={encode(option.id)}
      disabled={option.disabled}
      title={option.title}
      aria-label={option.ariaLabel}
      className={itemClassName(option.id === value, option)}
    >{option.label}</Toggle>)}
  </ToggleGroup>;
}

// Base UI Toggle swaps a falsy value (such as '' for "自动") for a generated id, so every value is prefixed.
const encode = (value: string) => `v:${value}`;
const decode = <T extends string>(value: string) => value.slice(2) as T;

