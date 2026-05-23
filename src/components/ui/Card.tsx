import type { HTMLAttributes, PropsWithChildren } from 'react';

export function Card({ className = '', children, ...props }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}
