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

