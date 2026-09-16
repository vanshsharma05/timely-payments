import { cx } from './Primitives';
import { formatCompact } from './format';

/**
 * The recovery list, one press from the worklist it is kept out of.
 *
 * Declared defaulters do not sit in "Overdue" with everybody else (see
 * isBadDebt() in types.ts); this is where they went. It renders only when
 * there is somebody on it, and reads as a filter — pressed, the list below
 * shows them and nothing else.
 */
export const BadDebtStrip = ({
    count,
    amount,
    active,
    onClick,
    className,
}: {
    count: number;
    amount: number;
    active: boolean;
    onClick: () => void;
    className?: string;
}) => {
    if (count === 0) return null;
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cx(
                'w-full flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-left transition-all active:scale-[.995]',
                active ? 'bg-dang text-card shadow-e2' : 'bg-dang-bg text-dang hover:brightness-95',
                className,
            )}
        >
            <span className="w-2.5 h-2.5 rounded-full bg-current flex-none" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-[13.5px] leading-snug">
                <span className="font-bold">Bad debt · {count.toLocaleString('en-IN')} account{count === 1 ? '' : 's'}</span>
                <span className="opacity-85"> · <span className="num font-semibold">{formatCompact(amount)}</span></span>
                <span className="opacity-85 max-md:hidden"> · kept out of the worklist above</span>
            </span>
            <span className="text-[12.5px] font-bold flex-none whitespace-nowrap">
                {active ? 'Showing the recovery list' : 'Recovery list →'}
            </span>
        </button>
    );
};
