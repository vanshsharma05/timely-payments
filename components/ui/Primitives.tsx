import React from 'react';
import { Outstanding, BalanceType } from '../../types';
import { formatCompact, formatINR, initials } from './format';

/* ============================================================================
   Components — Apple structure, Google affordances.

   · Content lives in soft rounded cards on a tinted ground (Apple grouped)
   · Anything interactive is filled, tonal or outlined in accent (Material 3)
   · Pills for buttons and chips, so a control never reads as plain text
   · Colour has exactly two jobs: accent = "you can touch this",
     the ageing ramp = "this is how old the money is"
   ============================================================================ */

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

/* --------------------------------- Button -------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  /* Material filled */
  primary: 'bg-accent text-on-accent shadow-e1 hover:bg-accent-press active:scale-[.98]',
  /* Material tonal — the workhorse secondary */
  secondary: 'bg-accent-tint text-accent hover:bg-accent-tint-2 active:scale-[.98]',
  /* Material text */
  ghost: 'bg-transparent text-label-2 hover:bg-hover hover:text-label',
  danger: 'bg-dang-bg text-dang hover:brightness-95 active:scale-[.98]',
  /* Neutral outlined */
  quiet: 'bg-card border border-separator-strong text-label-2 hover:bg-hover hover:text-label',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5',
  md: 'h-10 px-4.5 text-[14px] gap-2',
  lg: 'h-12 px-6 text-[15px] gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

export const Button = ({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    className={cx(
      'inline-flex items-center justify-center font-semibold whitespace-nowrap rounded-full',
      'transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
      BUTTON_VARIANT[variant],
      BUTTON_SIZE[size],
      className
    )}
  >
    {icon}
    {children}
  </button>
);

/* ---------------------------------- Chip --------------------------------- */

/** Material filter chip — selected state is unmistakable. */
export const Chip = ({
  selected = false,
  onClick,
  children,
  className,
  title,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-pressed={selected}
    className={cx(
      'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[13px] font-semibold',
      'transition-colors duration-150 border',
      selected
        ? 'bg-accent-tint text-accent border-accent-tint-2'
        : 'bg-transparent text-label-2 border-separator-strong hover:bg-hover hover:text-label',
      className
    )}
  >
    {children}
  </button>
);

/* -------------------------- Segmented control ---------------------------- */

/** Apple segmented control — for switching how the same data is shown. */
export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: React.ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
}) => (
  <div className={cx('inline-flex items-center gap-0.5 p-1 bg-card-3 rounded-[11px]', className)} role="tablist">
    {options.map(o => {
      const on = o.value === value;
      return (
        <button
          key={o.value}
          role="tab"
          aria-selected={on}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 px-3.5 rounded-[9px] text-[13px] font-semibold transition-all duration-150',
            on ? 'bg-card text-label shadow-e1' : 'text-label-3 hover:text-label-2'
          )}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

/* --------------------------------- Badge --------------------------------- */

type Tone = 'neutral' | 'brand' | 'pos' | 'warn' | 'dang' | 'age1' | 'age2' | 'age3' | 'age4';

const TONE: Record<Tone, string> = {
  neutral: 'bg-card-3 text-label-2',
  brand: 'bg-accent-tint text-accent',
  pos: 'bg-pos-bg text-pos',
  warn: 'bg-warn-bg text-warn',
  dang: 'bg-dang-bg text-dang',
  age1: 'bg-age-1-bg text-age-1-ink',
  age2: 'bg-age-2-bg text-age-2-ink',
  age3: 'bg-age-3-bg text-age-3-ink',
  age4: 'bg-age-4-bg text-age-4-ink',
};

export const Badge = ({
  tone = 'neutral',
  children,
  className,
  title,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
  title?: string;
}) => (
  <span
    title={title}
    className={cx(
      'inline-flex items-center gap-1 rounded-full px-2 py-[3px]',
      'text-[11.5px] font-semibold leading-tight whitespace-nowrap',
      TONE[tone],
      className
    )}
  >
    {children}
  </span>
);

/* ---------------------------------- Card --------------------------------- */

/** Apple grouped card: soft corners, gentle elevation, no hard border. */
export const Card = ({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} className={cx('bg-card rounded-[16px] shadow-e1', className)}>
    {children}
  </div>
);

export const SectionHeader = ({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) => (
  <div className={cx('flex items-start justify-between gap-4 flex-wrap', className)}>
    <div className="min-w-0">
      <h2 className="text-[17px] font-bold text-label tracking-[-0.02em]">{title}</h2>
      {subtitle && <p className="text-[13.5px] text-label-3 mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
  </div>
);

/* --------------------------------- Money --------------------------------- */

/** Dr = they owe us, Cr = we are holding their money. */
export const Money = ({
  amount,
  type,
  compact = true,
  className,
  showType = true,
}: {
  amount: number | undefined;
  type?: BalanceType;
  compact?: boolean;
  className?: string;
  showType?: boolean;
}) => {
  const value = Math.abs(Number(amount) || 0);
  const isCredit = type === 'Cr';
  return (
    <span
      className={cx('num whitespace-nowrap', isCredit && 'text-pos', className)}
      title={formatINR(value) + (isCredit ? ' credit (advance with us)' : '')}
    >
      {compact ? formatCompact(value) : formatINR(value)}
      {showType && isCredit && <span className="ml-1 text-[10.5px] align-top opacity-70">CR</span>}
    </span>
  );
};

/* ------------------------------- Ageing ---------------------------------- */

export interface AgeingParts {
  a1: number;
  a2: number;
  a3: number;
  a4: number;
}

export function ageingOf(item: Outstanding): AgeingParts {
  return {
    a1: Math.abs(item.ageing?.['1-45'] || 0),
    a2: Math.abs(item.ageing?.['46-90'] || 0),
    a3: Math.abs(item.ageing?.['91-135'] || 0),
    a4: Math.abs(item.ageing?.['>135'] || 0),
  };
}

export const AGE_BANDS = [
  { key: 'a1' as const, label: '1–45 days', short: '1–45', varName: 'var(--age-1)', tone: 'age1' as Tone },
  { key: 'a2' as const, label: '46–90 days', short: '46–90', varName: 'var(--age-2)', tone: 'age2' as Tone },
  { key: 'a3' as const, label: '91–135 days', short: '91–135', varName: 'var(--age-3)', tone: 'age3' as Tone },
  { key: 'a4' as const, label: 'Over 135 days', short: '>135', varName: 'var(--age-4)', tone: 'age4' as Tone },
];

/** One glance says whether a balance is healthy or rotting. */
export const AgeingBar = ({
  parts,
  height = 8,
  className,
  showEmpty = true,
}: {
  parts: AgeingParts;
  height?: number;
  className?: string;
  showEmpty?: boolean;
}) => {
  const total = parts.a1 + parts.a2 + parts.a3 + parts.a4;
  if (total <= 0) {
    return showEmpty ? (
      <div className={cx('w-full bg-card-3 rounded-full', className)} style={{ height }} aria-hidden="true" />
    ) : null;
  }
  return (
    <div
      className={cx('w-full flex gap-[2px] rounded-full overflow-hidden bg-card-3', className)}
      style={{ height }}
      role="img"
      aria-label={AGE_BANDS.filter(b => parts[b.key] > 0)
        .map(b => `${b.label}: ${formatCompact(parts[b.key])}`)
        .join(', ')}
    >
      {AGE_BANDS.map(band => {
        const v = parts[band.key];
        if (v <= 0) return null;
        return (
          <div
            key={band.key}
            className="first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(v / total) * 100}%`, background: band.varName }}
            title={`${band.label} — ${formatCompact(v)} (${Math.round((v / total) * 100)}%)`}
          />
        );
      })}
    </div>
  );
};

export const AgeingLegend = ({ className }: { className?: string }) => (
  <div className={cx('flex items-center gap-4 flex-wrap', className)}>
    {AGE_BANDS.map(b => (
      <span key={b.key} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-label-3">
        <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: b.varName }} aria-hidden="true" />
        {b.short}
      </span>
    ))}
  </div>
);

/* ------------------------------ Person chip ------------------------------ */

export const PersonChip = ({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md';
  className?: string;
}) => {
  const label = (name || '').trim();
  if (!label) {
    return <span className={cx('text-[12.5px] text-label-3', className)}>Unassigned</span>;
  }
  return (
    <span className={cx('inline-flex items-center gap-2 min-w-0', className)}>
      <span
        className={cx(
          'rounded-full flex-none grid place-items-center font-bold bg-accent-tint text-accent',
          size === 'sm' ? 'w-[20px] h-[20px] text-[9.5px]' : 'w-[24px] h-[24px] text-[10.5px]'
        )}
        aria-hidden="true"
      >
        {initials(label)}
      </span>
      <span className="text-[13px] text-label-2 truncate capitalize">{label.toLowerCase()}</span>
    </span>
  );
};

/* --------------------------------- Stat ---------------------------------- */

export const Stat = ({
  label,
  value,
  sub,
  tone = 'neutral',
  active = false,
  onClick,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  icon?: React.ReactNode;
}) => {
  const dot: Record<string, string> = {
    neutral: 'var(--label-4)',
    brand: 'var(--accent)',
    pos: 'var(--age-1)',
    warn: 'var(--age-2)',
    dang: 'var(--age-3)',
    age1: 'var(--age-1)',
    age2: 'var(--age-2)',
    age3: 'var(--age-3)',
    age4: 'var(--age-4)',
  };
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      aria-pressed={onClick ? active : undefined}
      className={cx(
        'relative text-left bg-card rounded-[16px] px-5 py-4 transition-all duration-150',
        onClick && 'cursor-pointer hover:shadow-e2 active:scale-[.99]',
        active ? 'shadow-e2 ring-2 ring-accent' : 'shadow-e1'
      )}
    >
      <span className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full flex-none" style={{ background: dot[tone] }} aria-hidden="true" />
        <span className="label">{label}</span>
        {icon && <span className="ml-auto text-label-3 flex-none">{icon}</span>}
      </span>
      <span className="block num text-[30px] font-semibold text-label mt-2.5 leading-none tracking-[-0.03em]">
        {value}
      </span>
      {sub && <span className="block text-[13px] text-label-3 mt-2.5 leading-snug">{sub}</span>}
    </Wrapper>
  );
};

/* ------------------------------ Empty state ------------------------------ */

export const EmptyState = ({
  title,
  hint,
  action,
  icon,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center text-center py-20 px-6">
    {icon && <div className="text-label-3 mb-4">{icon}</div>}
    <p className="text-[17px] font-bold text-label tracking-[-0.02em]">{title}</p>
    {hint && <p className="text-[14px] text-label-3 mt-2 max-w-sm leading-relaxed">{hint}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);

/* -------------------------------- Loading -------------------------------- */

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cx('animate-spin', className)} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".2" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const SkeletonRow = ({ cols = 6 }: { cols?: number }) => (
  <tr className="border-b border-separator">
    {Array.from({ length: cols }).map((_, i) => (
      <td key={i} className="px-3 py-3.5">
        <div className="h-3 rounded-full bg-card-3 animate-pulse" style={{ width: `${45 + ((i * 37) % 50)}%` }} />
      </td>
    ))}
  </tr>
);
