import { ChequeState, PdcCheque, chequeState } from '../../types';
import { cx } from './Primitives';

/**
 * The six places a cheque can be, in the words the whole app uses for them.
 *
 * The register, its cards and chips, the customer dialog and the morning
 * summary each had their own spelling — "Today's Due", "Date passed, not
 * banked", "Pending", "Overdue", "Upcoming PDCs" — for the same six states
 * that chequeState() works out. One table, one label each, one line saying
 * what it means.
 */
export const CHEQUE_STATES: Record<ChequeState, {
    label: string;
    /** What the state means, for a tooltip or a card's second line. */
    hint: string;
    /** The badge's colours. */
    badge: string;
    /** The dot on a card or chip. */
    dot: string;
    /** The list's left edge. */
    edge: string;
}> = {
    overdue: {
        label: 'Date passed',
        hint: 'In hand and its date has gone — bank it, or say why not',
        badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
        dot: 'var(--age-4)',
        edge: 'border-l-rose-500',
    },
    due: {
        label: 'Due today',
        hint: 'In hand and dated today — present it at the bank',
        badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
        dot: 'var(--age-2)',
        edge: 'border-l-amber-400',
    },
    bounced: {
        label: 'Bounced',
        hint: 'Returned unpaid by the bank — needs a call',
        badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
        dot: 'var(--dang)',
        edge: 'border-l-rose-700',
    },
    hold: {
        label: 'On hold',
        hint: 'Deliberately not being presented, usually at the customer\'s request',
        badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
        dot: 'var(--age-3)',
        edge: 'border-l-orange-400',
    },
    upcoming: {
        label: 'Upcoming',
        hint: 'In hand, waiting for its date',
        badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300',
        dot: 'var(--accent)',
        edge: 'border-l-blue-400',
    },
    cleared: {
        label: 'Cleared',
        hint: 'The bank paid it',
        badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
        dot: 'var(--age-1)',
        edge: 'border-l-emerald-500',
    },
};

/** The states in the order a person needs them: what needs doing first. */
export const CHEQUE_STATE_ORDER: ChequeState[] = ['overdue', 'due', 'bounced', 'hold', 'upcoming', 'cleared'];

export const ChequeStateBadge = ({ state, className }: { state: ChequeState; className?: string }) => (
    <span
        title={CHEQUE_STATES[state].hint}
        className={cx('inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-semibold leading-5 whitespace-nowrap', CHEQUE_STATES[state].badge, className)}
    >
        {CHEQUE_STATES[state].label}
    </span>
);

/**
 * The register's order: what is in hand first, by date, so the cheque that
 * should have been banked last week is at the top and today's are under it;
 * then the exceptions (bounced, on hold); cleared last, newest first, because
 * a cleared cheque is history. Sorting the whole register by date put August's
 * cleared cheques above this morning's.
 */
const GROUP: Record<ChequeState, number> = { overdue: 0, due: 0, upcoming: 0, bounced: 1, hold: 2, cleared: 3 };

export function sortCheques<T extends Pick<PdcCheque, 'chequeDate'> & { state: ChequeState }>(cheques: T[]): T[] {
    return [...cheques].sort((a, b) => {
        const g = GROUP[a.state] - GROUP[b.state];
        if (g !== 0) return g;
        const d = new Date(a.chequeDate).getTime() - new Date(b.chequeDate).getTime();
        return a.state === 'cleared' ? -d : d;
    });
}

/** The state of a cheque as stored, worked out today — for callers without the precomputed field. */
export const stateOf = (cheque: Pick<PdcCheque, 'status' | 'chequeDate'>, today: Date = new Date()): ChequeState =>
    chequeState({ status: cheque.status, chequeDate: cheque.chequeDate instanceof Date ? cheque.chequeDate : new Date(cheque.chequeDate) }, today);
