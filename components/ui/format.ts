import { Outstanding, FollowUpStatus } from '../../types';

/**
 * Money formatting for an Indian receivables book.
 *
 * The people using this think in lakhs and crores, and the tables are dense,
 * so full figures like 40,29,276 cost a lot of horizontal room and are slower
 * to compare at a glance. Compact form is the default in tables; the exact
 * figure is always available in a tooltip and is used wherever a number is
 * being acted on (editing, cheque amounts, exports).
 */

const CRORE = 10_000_000;
const LAKH = 100_000;

/** 4029276 -> "40,29,276" (Indian digit grouping) */
export function groupIndian(n: number): string {
  const neg = n < 0;
  const s = Math.round(Math.abs(n)).toString();
  let out: string;
  if (s.length <= 3) out = s;
  else {
    const last3 = s.slice(-3);
    const rest = s.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
  }
  return (neg ? '-' : '') + out;
}

/** Exact figure with symbol: "₹40,29,276" */
export function formatINR(n: number | undefined | null): string {
  return '₹' + groupIndian(Number(n) || 0);
}

/** Dense form for tables: "₹40.3 L", "₹1.13 Cr", "₹8,540" */
export function formatCompact(n: number | undefined | null): string {
  const v = Math.abs(Number(n) || 0);
  if (v === 0) return '₹0';
  const sign = (Number(n) || 0) < 0 ? '-' : '';
  if (v >= CRORE) {
    const c = v / CRORE;
    return `${sign}₹${c >= 100 ? Math.round(c) : c.toFixed(2)} Cr`;
  }
  if (v >= LAKH) {
    const l = v / LAKH;
    return `${sign}₹${l >= 100 ? Math.round(l) : l.toFixed(1)} L`;
  }
  return sign + '₹' + groupIndian(v);
}


export function formatDate(d: Date | string | undefined | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateShort(d: Date | string | undefined | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

/**
 * A calendar day as a date input writes it: "2026-09-14", in local time.
 *
 * `toISOString().slice(0, 10)` gives the UTC day, which in Ludhiana is
 * yesterday until half past five in the morning — so a form opened early
 * defaulted to a date that was already overdue.
 */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The local midnight a date input's value names; null if it is not a date. */
export function dateFromLocalIso(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

/** Today at midnight, local time: the day every follow-up date is measured against. */
export function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/** "in 3 days" / "4 days ago" / "today" — used on follow-up dates. */
export function relativeDays(d: Date | string | undefined | null): { text: string; days: number } | null {
  if (!d) return null;
  const date = d instanceof Date ? new Date(d) : new Date(d);
  if (isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return { text: 'today', days };
  if (days === 1) return { text: 'tomorrow', days };
  if (days === -1) return { text: 'yesterday', days };
  if (days > 0) return { text: `in ${days} days`, days };
  return { text: `${Math.abs(days)} days ago`, days };
}

/** Initials for the avatar chips in the CRM column. */
export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * When the follow-up is, beside the badge that says where it stands:
 * "19 Sept", "3d late · 14 Sept", "in 5d · 22 Sept", "No date".
 *
 * The badge already carries the state, so this says only *when*. It used to
 * repeat the badge — an account due today read "Today  Today", and an overdue
 * one "Overdue  3d overdue · 14 Sept".
 */
export const followUpWhen = (item: Outstanding, today: Date): string => {
    if (!item.followUpDate) return 'No date';
    const d = new Date(item.followUpDate);
    if (isNaN(d.getTime())) return 'No date';
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - t.getTime()) / 86_400_000);
    const short = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (item.status === FollowUpStatus.Completed) return short;
    if (diff === 0) return short;
    if (diff < 0) return `${-diff}d late · ${short}`;
    if (diff === 1) return `Tomorrow · ${short}`;
    return diff <= 14 ? `in ${diff}d · ${short}` : short;
};

/**
 * "Today", "Tomorrow · 18 Sept", "in 4d · 21 Sept", "3d ago · 14 Sept",
 * "25 Aug": when a cheque is dated, relative to today, for the register.
 * The same shape as followUpWhen so the two lists read alike.
 */
export const chequeWhen = (date: Date | string, today: Date): string => {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'No date';
    const day = new Date(d); day.setHours(0, 0, 0, 0);
    const t = new Date(today); t.setHours(0, 0, 0, 0);
    const diff = Math.round((day.getTime() - t.getTime()) / 86_400_000);
    const short = d.toLocaleDateString('en-IN', d.getFullYear() === t.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
    if (diff === 0) return 'Today';
    if (diff === 1) return `Tomorrow · ${short}`;
    if (diff === -1) return `Yesterday · ${short}`;
    if (diff < 0 && diff >= -30) return `${-diff}d ago · ${short}`;
    if (diff > 0 && diff <= 14) return `in ${diff}d · ${short}`;
    return short;
};
