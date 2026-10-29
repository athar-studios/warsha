// @warsha/ui — Shared React components for Warsha apps
// RTL-aware, uses logical CSS properties

import React from 'react';

export interface BoxProps {
  children?: React.ReactNode;
  className?: string;
  p?: number;
  m?: number;
  dir?: 'rtl' | 'ltr' | 'auto';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Box({ children, className = '', p = 0, m = 0, dir = 'auto', style, onClick }: BoxProps) {
  return (
    <div
      className={className}
      dir={dir}
      onClick={onClick}
      style={{
        paddingInline: p ? `${p * 4}px` : 0,
        marginInline: m ? `${m * 4}px` : 0,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface TextProps {
  children: React.ReactNode;
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'bold';
  dir?: 'rtl' | 'ltr' | 'auto';
  style?: React.CSSProperties;
}

export function Text({ children, className = '', size = 'md', weight = 'normal', dir = 'auto', style }: TextProps) {
  const sizeMap = { xs: '0.75rem', sm: '0.875rem', md: '1rem', lg: '1.125rem', xl: '1.25rem' };
  const weightMap = { normal: 400, medium: 500, bold: 700 };
  return (
    <span
      className={className}
      dir={dir}
      style={{
        fontSize: sizeMap[size],
        fontWeight: weightMap[weight],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  dir?: 'rtl' | 'ltr' | 'auto';
}

export function Button({ children, variant = 'primary', size = 'md', dir = 'auto', className = '', style, ...props }: ButtonProps) {
  const baseStyle: React.CSSProperties = {
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
  };

  const variantStyles: Record<'primary' | 'secondary' | 'ghost', React.CSSProperties> = {
    primary: { backgroundColor: '#2563eb', color: 'white' },
    secondary: { backgroundColor: '#e5e7eb', color: '#1f2937' },
    ghost: { backgroundColor: 'transparent', color: '#2563eb' },
  };

  const sizeStyles: Record<'sm' | 'md' | 'lg', React.CSSProperties> = {
    sm: { paddingInline: '12px', paddingBlock: '6px', fontSize: '0.875rem' },
    md: { paddingInline: '16px', paddingBlock: '10px', fontSize: '1rem' },
    lg: { paddingInline: '24px', paddingBlock: '14px', fontSize: '1.125rem' },
  };

  return (
    <button
      dir={dir}
      className={className}
      style={{
        ...baseStyle,
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export interface CardProps {
  children: React.ReactNode;
  className?: string;
  dir?: 'rtl' | 'ltr' | 'auto';
  style?: React.CSSProperties;
  onClick?: () => void;
}

export function Card({ children, className = '', dir = 'auto', style, onClick }: CardProps) {
  return (
    <div
      className={className}
      dir={dir}
      onClick={onClick}
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
        padding: '16px',
        ...style,
      }}
    >
      {children}
    </div>
  );
}