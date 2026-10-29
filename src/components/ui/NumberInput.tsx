import { NumberField } from '@base-ui/react/number-field';

// Plain integers in every locale: no grouping, so "1000" reads back as typed and never as "1,000".
const INTEGER_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 0, useGrouping: false };

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  id?: string;
  label?: string;
  title?: string;
  describedBy?: string;
  required?: boolean;
  disabled?: boolean;
  /** Classes for the wrapper; the input keeps `className`. */
  rootClassName?: string;
  className?: string;
}

/**
 * Integer field on Base UI NumberField. Typing keeps partial text such as "-" or an emptied field
 * instead of snapping it to 0 or the minimum; only a parseable number reaches `onChange`, clamped
 * to min/max, and blur restores the last valid value. Arrow keys step by 1.
 */
export function NumberInput({ value, onChange, min, max, id, label, title, describedBy, required, disabled, rootClassName, className = '' }: NumberInputProps) {
  return <NumberField.Root
    id={id}
    value={value}
    min={min}
    max={max}
    step={1}
    format={INTEGER_FORMAT}
    locale="zh-CN"
    required={required}
    disabled={disabled}
    className={rootClassName}
    onValueChange={(next) => { if (next !== null) onChange(Math.round(next)); }}
  >
    <NumberField.Input aria-label={label} aria-describedby={describedBy} title={title} className={className} />
  </NumberField.Root>;
}
