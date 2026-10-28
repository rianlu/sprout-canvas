import { Switch as BaseSwitch } from '@base-ui/react/switch';

/** On/off control on Base UI Switch: role="switch", a visible focus ring and a disabled state. */
export function Switch({ label, checked, onChange, disabled, describedBy, className = '' }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
}) {
  return <BaseSwitch.Root
    aria-label={label}
    aria-describedby={describedBy}
    checked={checked}
    disabled={disabled}
    onCheckedChange={(next) => onChange(next)}
    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-[2px] transition-colors bg-surface-container-highest data-[checked]:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed cursor-pointer ${className}`}
  >
    <BaseSwitch.Thumb className="h-4 w-4 rounded-full bg-white shadow-sm transition-transform data-[checked]:translate-x-4" />
  </BaseSwitch.Root>;
}
