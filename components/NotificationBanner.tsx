interface NotificationBannerProps {
  urgentCount: number;
  overdueCount: number;
  onDismiss: () => void;
  onView?: () => void;
}

/**
 * Material banner. It appears on every visit, so it states the count calmly
 * and offers the action — shouting in red every morning only teaches people
 * to stop looking at it.
 */
const NotificationBanner = ({ urgentCount, overdueCount, onView, onDismiss }: NotificationBannerProps) => {
  const parts: string[] = [];
  if (urgentCount > 0) parts.push(`${urgentCount} urgent account${urgentCount > 1 ? 's' : ''}`);
  if (overdueCount > 0) parts.push(`${overdueCount} overdue follow-up${overdueCount > 1 ? 's' : ''}`);
  if (parts.length === 0) return null;

  const critical = urgentCount > 0;

  return (
    <div>
      <div
        role="status"
        className={`flex items-center gap-3.5 rounded-[16px] px-4 py-3.5 ${
          critical ? 'bg-dang-bg' : 'bg-warn-bg'
        }`}
      >
        <span
          className={`w-9 h-9 rounded-full grid place-items-center flex-none ${
            critical ? 'text-dang' : 'text-warn'
          }`}
          style={{ background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
          aria-hidden="true"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8.5v4.5" />
            <circle cx="12" cy="16.6" r=".6" fill="currentColor" />
            <path d="M10.3 3.9 2.6 17.4A2 2 0 0 0 4.3 20.4h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </span>

        <p className={`text-[14px] flex-1 min-w-0 ${critical ? 'text-dang' : 'text-warn'}`}>
          <span className="font-bold">{parts.join(' · ')}</span>
          <span className="opacity-80"> need attention.</span>
        </p>

        {onView && (
          <button
            onClick={onView}
            className={`h-9 px-4 rounded-full text-[13.5px] font-bold transition-transform active:scale-[.98] ${
              critical ? 'bg-dang text-card' : 'bg-warn text-card'
            }`}
          >
            Show them
          </button>
        )}
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className={`w-9 h-9 grid place-items-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10 ${
            critical ? 'text-dang' : 'text-warn'
          }`}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default NotificationBanner;
