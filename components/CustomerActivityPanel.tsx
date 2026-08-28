import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityEntry,
    ActivityKind,
    ACTIVITY_LABELS,
    Outstanding,
    User,
    UserRole,
    can,
    promiseState,
    PromiseState,
} from '../types';
import * as repo from '../services/repository';
import { formatCurrencyValue } from './BalanceAmount';
import { TrashIcon } from './icons/Icons';

/**
 * The shared record of an account, beside the follow-up form.
 *
 * The follow-up form says what happens next. This says what happened: who rang,
 * when, whether anyone picked up, what they promised. Everyone on the team sees
 * the same thread, so whoever calls this customer tomorrow already knows what
 * was tried today.
 *
 * Entries are never edited. A promise is settled by adding the entry that
 * settles it, so the account reads as a history rather than a set of fields
 * that quietly changed.
 */

interface Props {
    customer: Outstanding;
    currentUser: User;
    /** Lets the parent fold new entries into the customer's flat notes list. */
    onLogged?: (entry: ActivityEntry) => void;
}

/** The buttons a CRM reaches for between calls, in the order they happen. */
const QUICK: { kind: ActivityKind; label: string; prefill: string }[] = [
    { kind: 'no_answer', label: 'No answer', prefill: 'Rang, no answer.' },
    { kind: 'declined', label: 'Call declined', prefill: 'Call was declined.' },
    { kind: 'promise', label: 'Promised to pay', prefill: '' },
    { kind: 'payment', label: 'Payment received', prefill: '' },
    { kind: 'visit', label: 'Visited', prefill: '' },
    { kind: 'dispute', label: 'Disputed', prefill: '' },
];

const TONE: Record<ActivityKind, string> = {
    note: 'bg-card-3 text-label-2',
    no_answer: 'bg-warn-bg text-warn',
    declined: 'bg-dang-bg text-dang',
    promise: 'bg-accent-tint text-accent',
    payment: 'bg-pos-bg text-pos',
    visit: 'bg-accent-tint text-accent',
    dispute: 'bg-dang-bg text-dang',
    system: 'bg-card-3 text-label-3',
};

const PROMISE_TONE: Record<PromiseState, string> = {
    open: 'bg-accent-tint text-accent',
    due: 'bg-warn-bg text-warn',
    overdue: 'bg-dang-bg text-dang',
    kept: 'bg-pos-bg text-pos',
    broken: 'bg-dang-bg text-dang',
};

const PROMISE_LABEL: Record<PromiseState, string> = {
    open: 'Promised',
    due: 'Due today',
    overdue: 'Overdue',
    kept: 'Kept',
    broken: 'Not kept',
};

/** "3 min ago" up to a week, then the date — a log is read by recency. */
function whenText(iso: string): string {
    const then = new Date(iso);
    const mins = Math.round((Date.now() - then.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.round(hrs / 24);
    if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
    return then.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const exactText = (iso: string) =>
    new Date(iso).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
    });

const initials = (name: string) =>
    name.trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || '?';

const CustomerActivityPanel = ({ customer, currentUser, onLogged }: Props) => {
    const [entries, setEntries] = useState<ActivityEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const [kind, setKind] = useState<ActivityKind>('note');
    const [body, setBody] = useState('');
    const [promisedAmount, setPromisedAmount] = useState('');
    const [promisedOn, setPromisedOn] = useState('');
    const [resolving, setResolving] = useState<{ id: string; kept: boolean } | null>(null);

    const endRef = useRef<HTMLDivElement>(null);
    const boxRef = useRef<HTMLTextAreaElement>(null);

    const mayWrite = can(currentUser, 'canEditFollowUp');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            setEntries(await repo.fetchActivity(customer.id));
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not load the activity.');
        } finally {
            setLoading(false);
        }
    }, [customer.id]);

    useEffect(() => { load(); }, [load]);

    // A conversation reads top to bottom, so the newest sits at the end and the
    // panel opens already scrolled to it.
    useEffect(() => {
        if (!loading) endRef.current?.scrollIntoView({ block: 'end' });
    }, [loading, entries.length]);

    /** Which entry, if any, settled each promise. */
    const resolutions = useMemo(() => {
        const byPromise = new Map<string, ActivityEntry>();
        for (const e of entries) if (e.resolvesId) byPromise.set(e.resolvesId, e);
        return byPromise;
    }, [entries]);

    const openPromises = useMemo(
        () => entries.filter(e => e.kind === 'promise' && !resolutions.has(e.id)),
        [entries, resolutions],
    );

    const reset = () => {
        setKind('note');
        setBody('');
        setPromisedAmount('');
        setPromisedOn('');
        setResolving(null);
    };

    const post = async () => {
        const text = body.trim();
        // A promise and a payment carry their meaning in the amount and date;
        // every other kind needs words, or the entry tells the next person
        // nothing.
        if (!text && kind !== 'promise' && kind !== 'payment') return;
        if (kind === 'promise' && !promisedOn) return;

        setSaving(true);
        try {
            const entry = await repo.addActivity({
                customerId: customer.id,
                kind,
                body: text,
                promisedAmount: promisedAmount ? Number(promisedAmount) : undefined,
                promisedOn: kind === 'promise' ? promisedOn : undefined,
                resolvesId: resolving?.id,
            }, currentUser);
            setEntries(prev => [...prev, entry]);
            onLogged?.(entry);
            reset();
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save that entry.');
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        const previous = entries;
        setEntries(prev => prev.filter(e => e.id !== id));
        try {
            await repo.deleteActivity(id);
        } catch (e) {
            setEntries(previous);
            setError(e instanceof Error ? e.message : 'Could not remove that entry.');
        }
    };

    /** Answering a promise: pre-loads the composer pointing back at it. */
    const answerPromise = (promise: ActivityEntry, kept: boolean) => {
        setResolving({ id: promise.id, kept });
        setKind(kept ? 'payment' : 'note');
        setBody(kept ? '' : 'Did not pay as promised. ');
        setPromisedAmount(kept && promise.promisedAmount ? String(promise.promisedAmount) : '');
        setTimeout(() => boxRef.current?.focus(), 0);
    };

    const postDisabled =
        saving ||
        (kind === 'promise' && !promisedOn) ||
        (!body.trim() && kind !== 'promise' && kind !== 'payment');

    return (
        <div className="flex flex-col h-full min-h-0 bg-card-2 lg:border-l border-separator">
            <div className="px-4 py-3 border-b border-separator flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-bold text-label">Account activity</h3>
                <span className="text-[12px] text-label-3">
                    {loading
                        ? 'loading…'
                        : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · everyone sees this`}
                </span>
            </div>

            {/* Anything still promised and unanswered, kept in view rather than
                buried up the thread. */}
            {openPromises.length > 0 && (
                <div className="px-4 py-2.5 border-b border-separator bg-card space-y-2">
                    {openPromises.map(p => {
                        const state = promiseState(p, undefined);
                        return (
                            <div key={p.id} className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded-full text-[11.5px] font-bold ${PROMISE_TONE[state]}`}>
                                    {PROMISE_LABEL[state]}
                                </span>
                                <span className="text-[13px] text-label-2">
                                    {p.promisedAmount ? formatCurrencyValue(p.promisedAmount) : 'Payment'}
                                    {p.promisedOn && ` by ${new Date(p.promisedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`}
                                </span>
                                {mayWrite && (state === 'due' || state === 'overdue') && (
                                    <span className="flex items-center gap-1 ml-auto">
                                        <button
                                            type="button"
                                            onClick={() => answerPromise(p, true)}
                                            className="px-2.5 py-1 min-h-[28px] rounded-md text-[12px] font-bold bg-pos-bg text-pos hover:opacity-80"
                                        >
                                            Paid
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => answerPromise(p, false)}
                                            className="px-2.5 py-1 min-h-[28px] rounded-md text-[12px] font-bold bg-dang-bg text-dang hover:opacity-80"
                                        >
                                            Did not pay
                                        </button>
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ------------------------------ thread ------------------------------ */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                {loading && <p className="text-[13px] text-label-3">Loading the record…</p>}

                {!loading && entries.length === 0 && (
                    <p className="text-[13px] text-label-3 leading-relaxed">
                        Nothing logged yet. Record what happened on a call here — it stays on the
                        account and the whole team can see it.
                    </p>
                )}

                {entries.map(entry => {
                    const mine = Boolean(entry.authorId) && entry.authorId === currentUser.authId;
                    const settled = resolutions.get(entry.id);
                    const state = entry.kind === 'promise' ? promiseState(entry, settled) : null;
                    return (
                        <div key={entry.id} className="group flex gap-2.5">
                            <div
                                className="w-7 h-7 flex-none grid place-items-center rounded-full bg-accent-tint text-accent text-[11px] font-bold"
                                aria-hidden="true"
                            >
                                {initials(entry.authorName)}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-[13px] font-bold text-label">{entry.authorName}</span>
                                    <span className="text-[11.5px] text-label-3" title={exactText(entry.createdAt)}>
                                        {whenText(entry.createdAt)}
                                    </span>
                                    {entry.kind !== 'note' && (
                                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${TONE[entry.kind]}`}>
                                            {ACTIVITY_LABELS[entry.kind]}
                                        </span>
                                    )}
                                    {state && (
                                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${PROMISE_TONE[state]}`}>
                                            {PROMISE_LABEL[state]}
                                        </span>
                                    )}
                                    {(mine || currentUser.role === UserRole.Admin) && (
                                        <button
                                            type="button"
                                            onClick={() => remove(entry.id)}
                                            title="Remove this entry"
                                            aria-label={`Remove the entry by ${entry.authorName}`}
                                            className="ml-auto w-7 h-7 grid place-items-center rounded-full text-label-3 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-dang hover:bg-hover"
                                        >
                                            <TrashIcon />
                                        </button>
                                    )}
                                </div>

                                {entry.kind === 'promise' && (
                                    <p className="text-[13px] font-semibold text-label-2 mt-0.5">
                                        {entry.promisedAmount ? formatCurrencyValue(entry.promisedAmount) : 'Payment'}
                                        {entry.promisedOn && ` by ${new Date(entry.promisedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`}
                                    </p>
                                )}

                                {entry.body && (
                                    <p className="text-[13.5px] text-label-2 whitespace-pre-wrap leading-relaxed mt-0.5 break-words">
                                        {entry.body}
                                    </p>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div ref={endRef} />
            </div>

            {/* ----------------------------- composer ----------------------------- */}
            {error && (
                <p className="px-4 py-2 text-[12.5px] text-dang bg-dang-bg border-t border-separator">{error}</p>
            )}

            {mayWrite ? (
                <div className="border-t border-separator p-3 bg-card">
                    {resolving && (
                        <p className="text-[12px] text-label-3 mb-2">
                            Answering the promise above ·{' '}
                            <button type="button" onClick={reset} className="text-accent font-semibold underline">
                                cancel
                            </button>
                        </p>
                    )}

                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {QUICK.map(q => (
                            <button
                                key={q.kind}
                                type="button"
                                onClick={() => {
                                    setKind(k => (k === q.kind ? 'note' : q.kind));
                                    if (q.prefill && !body.trim()) setBody(q.prefill);
                                    boxRef.current?.focus();
                                }}
                                className={`px-2.5 py-1 min-h-[28px] rounded-full text-[12px] font-semibold border transition-colors ${
                                    kind === q.kind
                                        ? 'bg-accent text-card border-accent'
                                        : 'bg-card-2 text-label-2 border-separator hover:bg-hover'
                                }`}
                            >
                                {q.label}
                            </button>
                        ))}
                    </div>

                    {(kind === 'promise' || kind === 'payment') && (
                        <div className="flex gap-2 mb-2">
                            <label className="flex-1">
                                <span className="sr-only">Amount</span>
                                <input
                                    type="number"
                                    min="0"
                                    value={promisedAmount}
                                    onChange={e => setPromisedAmount(e.target.value)}
                                    placeholder="Amount ₹"
                                    className="w-full rounded-lg border border-separator bg-card-2 px-2.5 py-2 text-[13px] text-label focus:ring-2 focus:ring-accent"
                                />
                            </label>
                            {kind === 'promise' && (
                                <label className="flex-1">
                                    <span className="sr-only">Promised by</span>
                                    <input
                                        type="date"
                                        value={promisedOn}
                                        onChange={e => setPromisedOn(e.target.value)}
                                        className="w-full rounded-lg border border-separator bg-card-2 px-2.5 py-2 text-[13px] text-label focus:ring-2 focus:ring-accent"
                                    />
                                </label>
                            )}
                        </div>
                    )}

                    <textarea
                        ref={boxRef}
                        value={body}
                        onChange={e => setBody(e.target.value)}
                        onKeyDown={e => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                e.preventDefault();
                                if (!postDisabled) post();
                            }
                        }}
                        rows={2}
                        aria-label="What happened"
                        placeholder="What happened? The time and your name are added automatically."
                        className="w-full rounded-lg border border-separator bg-card-2 px-3 py-2 text-[13.5px] text-label leading-relaxed resize-y focus:ring-2 focus:ring-accent"
                    />

                    <div className="flex items-center justify-between gap-2 mt-2">
                        <span className="text-[11.5px] text-label-3">
                            {kind === 'promise' && !promisedOn ? 'Pick the date they promised.' : 'Ctrl + Enter to post'}
                        </span>
                        <button
                            type="button"
                            onClick={post}
                            disabled={postDisabled}
                            className="px-4 py-2 min-h-[36px] rounded-lg bg-accent text-card text-[13px] font-bold disabled:opacity-40 hover:bg-accent-press"
                        >
                            {saving ? 'Saving…' : 'Log it'}
                        </button>
                    </div>
                </div>
            ) : (
                <p className="border-t border-separator p-3 text-[12.5px] text-label-3">
                    You can read this record but not add to it.
                </p>
            )}
        </div>
    );
};

export default CustomerActivityPanel;
