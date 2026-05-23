import type { ButtonHTMLAttributes, PropsWithChildren } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}

export function Button({ variant = 'secondary', className = '', children, ...props }: PropsWithChildren<ButtonProps>) {
  return <button className={`btn btn-${variant} ${className}`} {...props}>{children}</button>;
}
