import type { HTMLAttributes } from 'react';

export interface StitchIconProps extends HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
}

export function StitchIcon({ name, size = 20, className = '', style, ...props }: StitchIconProps) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={`material-symbols-outlined shrink-0 ${className}`}
      style={{ fontSize: size, ...style }}
    >
      {name}
    </span>
  );
}
