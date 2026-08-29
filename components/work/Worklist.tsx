import { useMemo } from 'react';
import {
    Outstanding,
    PAYMENT_RANK_LABELS,
    PaymentRank,
    PdcCheque,
    chequeState,
    getCustomerPaymentRank,
    getFollowUpCategory,
    hasOutstanding,
} from '../../types';
import { Badge, EmptyState, cx } from '../ui/Primitives';
import { formatCompact, formatINR, relativeDays } from '../ui/format';

/* ============================================================================
   The queue.

   The old landing screen was a summary of the work: four counters over a
   portfolio chart, and pressing one threw you into a different tab with a
   filter applied. Somebody opening this at nine in the morning wants the list,
   not a description of the list — so the counters and the list are the same
   thing here. The chips say how much of each kind of work there is and switch
   between them in place; nothing navigates.

   Each row carries the one fact that decides what you say when they pick up:
   the last thing that happened on the account.
   ========================================================================== */

export type QueueKey = 'today' | 'overdue' | 'promised' | 'cheques' | 'no_plan' | 'all';

export interface QueueDef {
    key: QueueKey;
    label: string;
    hint: string;
    tone: 'brand' | 'dang' | 'warn' | 'pos' | 'neutral';
}

export const QUEUES: QueueDef[] = [
    { key: 'today',    label: 'Due today',   hint: 'You planned to chase these today.',                 tone: 'brand' },
    { key: 'overdue',  label: 'Overdue',     hint: 'The date you set has gone by. Oldest money first.', tone: 'dang' },
    { key: 'promised', label: 'Promised',    hint: 'They said money would come. Check it arrived.',     tone: 'pos' },
    { key: 'cheques',  label: 'Cheques',     hint: 'In hand and ready to bank, or past their date.',    tone: 'warn' },
    { key: 'no_plan',  label: 'No plan',     hint: 'Owes money with nothing scheduled against it.',     tone: 'warn' },
    { key: 'all',      label: 'Everything',  hint: 'Every account you are carrying that owes money.',   tone: 'neutral' },
];

const RANK_TONE: Record<PaymentRank, 'pos' | 'warn' | 'dang'> = { Good: 'pos', Late: 'warn', Bad: 'dang' };

/** The last thing anybody recorded, stripped of the timestamp prefix. */
function lastWord(item: Outstanding): string {
    const note = (item.notes || [])[item.notes.length - 1];
    if (!note) return '';
    return note.replace(/^\[[^\]]*\]\s*/, '').trim();
}

export interface QueueCounts {
    today: number; overdue: number; promised: number; cheques: number; no_plan: number; all: number;
}

/**
 * Splits one person's book into the queues. Done once for every chip, so the
 * counts on the chips and the rows behind them can never disagree.
 */
export function buildQueues(rows: Outstanding[], cheques: PdcCheque[], today = new Date()) {
    const owing = rows.filter(hasOutstanding);
    const mine = new Set(rows.map(r => r.id));

    const chequesDue = cheques
        .filter(c => mine.has(c.customerId))
        .map(c => ({ cheque: c, state: chequeState(c, today) }))
        .filter(c => c.state === 'due' || c.state === 'overdue');
    const chequeAccounts = new Set(chequesDue.map(c => c.cheque.customerId));

    const byValue = (a: Outstanding, b: Outstanding) => (b.total || 0) - (a.total || 0);
    const byDate = (a: Outstanding, b: Outstanding) =>
        new Date(a.followUpDate || 0).getTime() - new Date(b.followUpDate || 0).getTime();

    const lists: Record<QueueKey, Outstanding[]> = {
        today: owing.filter(r => getFollowUpCategory(r, today) === 'today').sort(byValue),
        overdue: owing.filter(r => getFollowUpCategory(r, today) === 'overdue').sort(byDate),
        promised: owing
            .filter(r => Number(r.forecastAmount) > 0)
            .sort((a, b) => Number(b.forecastAmount) - Number(a.forecastAmount)),
        cheques: owing.filter(r => chequeAccounts.has(r.id)).sort(byValue),
        no_plan: owing.filter(r => getFollowUpCategory(r, today) === 'no_follow_up').sort(byValue),
        all: [...owing].sort(byValue),
    };

    const counts = {
        today: lists.today.length,
        overdue: lists.overdue.length,
        promised: lists.promised.length,
        cheques: lists.cheques.length,
        no_plan: lists.no_plan.length,
        all: lists.all.length,
    };

    return { lists, counts, chequesHeld: chequesDue.length };
}

interface Props {
    rows: Outstanding[];
    cheques: PdcCheque[];
    active: QueueKey;
    onQueue: (key: QueueKey) => void;
    selectedId?: string;
    onSelect: (customer: Outstanding) => void;
    search: string;
    onSearch: (value: string) => void;
    /** Whole-book readers see who owns each account; a CRM already knows. */
    showOwner?: boolean;
}

const Worklist = ({
    rows,
    cheques,
    active,
    onQueue,
    selectedId,
    onSelect,
    search,
    onSearch,
    showOwner,
}: Props) => {
    const { lists, counts } = useMemo(() => buildQueues(rows, cheques), [rows, cheques]);

    const visible = useMemo(() => {
        const list = lists[active] || [];
        const q = search.trim().toLowerCase();
        if (!q) return list;
        const tokens = q.split(/\s+/).filter(Boolean);
        return list.filter(item => {
            const hay = [
                item.company, item.contactPerson, item.contactNumber, item.city,
                item.crmOwnerId, item.assignedCollectorId, ...(item.notes || []),
            ].join(' ').toLowerCase();
            return tokens.every(t => hay.includes(t));
        });
    }, [lists, active, search]);

    const activeDef = QUEUES.find(q => q.key === active) || QUEUES[0];
    const total = visible.reduce((s, r) => s + (r.totalType === 'Cr' ? 0 : r.total || 0), 0);

    return (
        <div className="flex flex-col h-full min-h-0 bg-card">
            {/* ------------------------------- chips ------------------------- */}
            <div className="px-3 pt-3 pb-2.5 border-b border-separator flex-none">
                <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="Worklist">
                    {QUEUES.map(q => {
                        const n = counts[q.key];
                        const on = q.key === active;
                        return (
                            <button
                                key={q.key}
                                role="tab"
                                aria-selected={on}
                                onClick={() => onQueue(q.key)}
                                title={q.hint}
                                className={cx(
                                    'flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] whitespace-nowrap transition-colors',
                                    on
                                        ? 'bg-accent text-on-accent font-bold'
                                        : 'bg-card-2 text-label-2 font-medium hover:bg-hover hover:text-label',
                                )}
                            >
                                {q.label}
                                <span
                                    className={cx(
                                        'num text-[11.5px] font-bold leading-none px-1.5 py-[3px] rounded-full',
                                        on ? 'bg-brand-yellow text-brand-yellow-ink' : n > 0 ? 'bg-card-3 text-label-2' : 'bg-card-3 text-label-3',
                                    )}
                                >
                                    {n > 999 ? '999+' : n}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="relative mt-2.5">
                    <input
                        value={search}
                        onChange={e => onSearch(e.target.value)}
                        placeholder="Filter this list"
                        aria-label="Filter this list"
                        className="w-full h-9 pl-3 pr-8 rounded-[10px] bg-card-2 border border-transparent text-[13.5px] text-label placeholder:text-label-3 outline-none focus:border-accent focus:bg-card transition-colors"
                    />
                    {search && (
                        <button
                            onClick={() => onSearch('')}
                            aria-label="Clear the filter"
                            className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover text-[15px] leading-none"
                        >
                            &times;
                        </button>
                    )}
                </div>

                <p className="text-[12px] text-label-3 mt-2 leading-snug">
                    {visible.length === 0
                        ? activeDef.hint
                        : <>{visible.length} account{visible.length === 1 ? '' : 's'} · <span className="num font-semibold text-label-2">{formatCompact(total)}</span></>}
                </p>
            </div>

            {/* -------------------------------- rows ------------------------- */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {visible.length === 0 ? (
                    <EmptyState
                        title={search ? 'Nothing matches that' : 'Nothing here'}
                        hint={search ? 'Try a shorter search, or another list above.' : activeDef.hint}
                    />
                ) : (
                    <ul>
                        {visible.map(item => {
                            const on = item.id === selectedId;
                            const rank = getCustomerPaymentRank(item);
                            const due = relativeDays(item.followUpDate);
                            const said = lastWord(item);
                            return (
                                <li key={item.id}>
                                    <button
                                        onClick={() => onSelect(item)}
                                        aria-current={on ? 'true' : undefined}
                                        className={cx(
                                            'w-full text-left px-4 py-3 border-b border-separator transition-colors',
                                            'border-l-[3px]',
                                            on
                                                ? 'bg-accent-tint border-l-accent'
                                                : 'border-l-transparent hover:bg-hover',
                                        )}
                                    >
                                        <div className="flex items-baseline gap-2.5">
                                            <span className="text-[14.5px] font-bold text-label truncate flex-1 min-w-0">
                                                {item.company}
                                            </span>
                                            <span
                                                className="num text-[14px] font-semibold text-label flex-none"
                                                title={formatINR(item.total)}
                                            >
                                                {formatCompact(item.total)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1.5">
                                            {rank !== 'Good' && (
                                                <Badge tone={RANK_TONE[rank]}>{PAYMENT_RANK_LABELS[rank]}</Badge>
                                            )}
                                            {item.isUrgent && <Badge tone="dang">Urgent</Badge>}
                                            {due && (
                                                <span className={cx('text-[12.5px] font-semibold', due.days < 0 ? 'text-dang' : 'text-label-2')}>
                                                    {due.text}
                                                </span>
                                            )}
                                            {active === 'promised' && Number(item.forecastAmount) > 0 && (
                                                <span className="num text-[12.5px] font-semibold text-pos">
                                                    expects {formatCompact(item.forecastAmount)}
                                                </span>
                                            )}
                                            {showOwner && item.crmOwnerId && (
                                                <span className="text-[12.5px] text-label-3">{item.crmOwnerId}</span>
                                            )}
                                        </div>

                                        {said && (
                                            <p className="text-[12.5px] text-label-3 mt-1.5 line-clamp-2 leading-snug">
                                                {said}
                                            </p>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default Worklist;
