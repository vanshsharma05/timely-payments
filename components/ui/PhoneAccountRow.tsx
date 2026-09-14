import React from 'react';
import { Outstanding, getCustomerPaymentRank, getFollowUpCategory, PAYMENT_RANK_LABELS } from '../../types';
import { AgeingBar, Badge, cx } from './Primitives';
import { formatCompact, formatDateShort, formatINR, relativeDays } from './format';
import { WhatsAppIcon } from '../icons/Icons';

/**
 * One account, as a phone shows it.
 *
 * The customer book and the reports are tables, and a table on a phone is a
 * choice between two bad things: shrink it until nothing can be read, or
 * scroll it sideways and lose the name from the number. So below `md` both
 * screens render this row instead — the name, the grade and the state on the
 * first line, who to ring on the second, the balance on the right, and the
 * ageing bar along the bottom, which is the one thing a table did well.
 *
 * The whole row opens the account. The one action worth a button of its own
 * is WhatsApp, because on a phone that is a tap away from the conversation.
 */
export interface PhoneAccountRowProps {
    item: Outstanding;
    /** Display name for the owner; falls back to the raw CRM code. */
    ownerName?: string;
    today: Date;
    onOpen: () => void;
    onWhatsApp?: () => void;
    /** When the list can be bulk-edited, a tick box leads the row. */
    selectable?: boolean;
    selected?: boolean;
    onToggleSelect?: () => void;
    /** Extra chips after the state — a cheque in hand, for instance. */
    extras?: React.ReactNode;
}

const RANK_TONE = { Good: 'pos', Late: 'warn', Bad: 'dang' } as const;

export const PhoneAccountRow = ({
    item,
    ownerName,
    today,
    onOpen,
    onWhatsApp,
    selectable,
    selected,
    onToggleSelect,
    extras,
}: PhoneAccountRowProps) => {
    const a1 = item.ageing?.['1-45'] || 0;
    const a2 = item.ageing?.['46-90'] || 0;
    const a3 = item.ageing?.['91-135'] || 0;
    const a4 = item.ageing?.['>135'] || 0;
    const over90 = item.over90 !== undefined ? item.over90 : a3 + a4;
    const rank = getCustomerPaymentRank(item);
    const cat = getFollowUpCategory(item, today);
    const due = relativeDays(item.followUpDate);
    const isCredit = item.totalType === 'Cr' && item.total > 0;
    const lastNote = item.notes && item.notes.length ? item.notes[item.notes.length - 1] : '';

    return (
        <div
            className={cx(
                'relative flex gap-3 px-3.5 py-3 bg-card transition-colors active:bg-press',
                selected && 'bg-accent-tint',
            )}
        >
            {selectable && (
                <label className="flex-none flex items-start pt-0.5 -ml-1 pl-1" onClick={e => e.stopPropagation()}>
                    <input
                        type="checkbox"
                        checked={!!selected}
                        onChange={onToggleSelect}
                        aria-label={`Select ${item.company}`}
                        className="w-5 h-5 rounded text-accent focus:ring-accent"
                    />
                </label>
            )}

            {/* The tappable body. A button, so it is reachable without a mouse. */}
            <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold text-label leading-snug break-words">
                            {item.company}
                        </p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                            <Badge tone={RANK_TONE[rank]}>{PAYMENT_RANK_LABELS[rank]}</Badge>
                            {item.isUrgent && <Badge tone="dang">Urgent</Badge>}
                            {cat === 'overdue' && <Badge tone="dang">Overdue{due ? ` · ${due.text}` : ''}</Badge>}
                            {cat === 'today' && <Badge tone="brand">Due today</Badge>}
                            {cat === 'future' && <Badge tone="pos">{due?.text || 'Scheduled'}</Badge>}
                            {cat === 'no_follow_up' && <Badge tone="warn">No follow-up</Badge>}
                            {cat === 'completed' && <Badge tone="pos">Collected</Badge>}
                            {extras}
                        </div>
                    </div>
                    <div className="text-right flex-none">
                        <p className={cx('num text-[15.5px] font-bold leading-tight', isCredit ? 'text-pos' : 'text-label')} title={formatINR(item.total)}>
                            {formatCompact(item.total)}
                            {isCredit && <span className="ml-1 text-[10px] align-top opacity-70">CR</span>}
                        </p>
                        {over90 > 0 && !isCredit && (
                            <p className="num text-[12px] font-semibold text-dang mt-0.5" title={`Past 90 days: ${formatINR(over90)}`}>
                                &gt;90d {formatCompact(over90)}
                            </p>
                        )}
                    </div>
                </div>

                <p className="text-[12.5px] text-label-3 mt-1.5 truncate">
                    {[item.contactPerson, item.contactNumber, item.city, ownerName || item.crmOwnerId]
                        .map(v => (v || '').trim())
                        .filter(Boolean)
                        .join(' · ') || 'No contact on file'}
                </p>
                {lastNote && (
                    <p className="text-[12px] text-label-4 mt-1 truncate" title={lastNote}>
                        {lastNote}
                    </p>
                )}

                <div className="flex items-center gap-3 mt-2.5">
                    <AgeingBar parts={{ a1, a2, a3, a4 }} height={5} className="flex-1" />
                    <span className="text-[11.5px] text-label-3 flex-none num">
                        {item.followUpDate ? `Next ${formatDateShort(item.followUpDate)}` : 'No date'}
                    </span>
                </div>
            </button>

            {onWhatsApp && (
                <button
                    type="button"
                    onClick={onWhatsApp}
                    aria-label={`WhatsApp ${item.company}`}
                    className="flex-none self-center w-11 h-11 -mr-1 grid place-items-center rounded-full text-pos bg-pos-bg active:brightness-95"
                >
                    <WhatsAppIcon className="w-5 h-5" />
                </button>
            )}
        </div>
    );
};

export default PhoneAccountRow;
