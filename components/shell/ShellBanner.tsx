import { CheckCircleIcon, ExclamationTriangleIcon } from '../icons/Icons';
import type { SyncStatus } from '../../services/useSupabaseSync';

export type ShellMessage = { type: 'success' | 'error'; text: string; action?: { label: string; run: () => void } } | null;

interface ShellBannerProps {
    /** A passing message: a sync result, a bulk action's outcome. */
    message: ShellMessage;
    /** What could not be saved, folded across every collection. */
    saveStatus: SyncStatus;
    onRetry: () => void;
    onDismiss: () => void;
}

/**
 * The banner at the top of the shell.
 *
 * A refused save is not a passing message: it stays here, with the reason
 * and a way to try again, until the server accepts it. A transient message
 * takes the banner over while it lasts, and can be dismissed; the refusal
 * cannot.
 */
export const ShellBanner = ({ message, saveStatus, onRetry, onDismiss }: ShellBannerProps) => {
    const refusedBanner = saveStatus.failed.length && !message ? {
        type: 'error' as const,
        text: `${saveStatus.failed.length} change${saveStatus.failed.length === 1 ? '' : 's'} could not be saved: ${saveStatus.failed[0].message}. `
            + `${saveStatus.failed.length === 1 ? 'It is' : 'They are'} kept in this tab`
            + (saveStatus.retryAt ? ` and will be tried again in ${Math.max(1, Math.round((saveStatus.retryAt - Date.now()) / 1000))}s.` : ' and will be tried again.'),
        action: { label: saveStatus.saving ? 'Retrying…' : 'Retry now', run: onRetry },
        dismissable: false,
    } : null;
    const bannerMessage = message ? { ...message, dismissable: true } : refusedBanner;
    if (!bannerMessage) return null;
    return (
        <div className="px-3 sm:px-5 lg:px-7 pt-4">
            <div
                role={bannerMessage.type === 'error' ? 'alert' : 'status'}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
                    bannerMessage.type === 'success'
                        ? 'bg-pos-bg border-pos text-pos'
                        : 'bg-dang-bg border-dang text-dang'
                }`}
            >
                <span className="mt-0.5 flex-none">
                    {bannerMessage.type === 'success'
                        ? <CheckCircleIcon className="w-[18px] h-[18px]" />
                        : <ExclamationTriangleIcon className="w-[18px] h-[18px]" />}
                </span>
                <p className="text-[14px] font-medium flex-1 leading-snug">{bannerMessage.text}</p>
                {bannerMessage.action && (
                    <button
                        onClick={bannerMessage.action.run}
                        disabled={saveStatus.saving && bannerMessage === refusedBanner}
                        className="text-[13px] font-bold underline underline-offset-2 whitespace-nowrap flex-none disabled:opacity-60"
                    >
                        {bannerMessage.action.label}
                    </button>
                )}
                {bannerMessage.dismissable && (
                    <button
                        onClick={onDismiss}
                        className="opacity-55 hover:opacity-100 flex-none leading-none text-lg"
                        aria-label="Dismiss"
                    >
                        &times;
                    </button>
                )}
            </div>
        </div>
    );
};

export default ShellBanner;
