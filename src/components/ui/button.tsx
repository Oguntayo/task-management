import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 select-none',
  { variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:opacity-90 shadow-sm',
        secondary: 'bg-surface border border-border-strong text-fg hover:bg-surface-2 shadow-sm',
        ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
        danger: 'bg-danger text-white hover:opacity-90',
        urgent: 'bg-urgent text-white hover:opacity-90 shadow-sm',
        link: 'text-accent underline-offset-4 hover:underline px-0 h-auto',
      },
      size: { sm: 'h-7 px-2.5', md: 'h-8 px-3', lg: 'h-10 px-4 text-sm', icon: 'h-8 w-8' },
    }, defaultVariants: { variant: 'secondary', size: 'md' } });

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { loading?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, loading, children, disabled, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
    {loading && <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}{children}
  </button>));
Button.displayName = 'Button';
