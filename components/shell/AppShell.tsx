import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from '../../types';
import { cx, Spinner } from '../ui/Primitives';
import { initials } from '../ui/format';
import shoriMark from '../../assets/shori-mark.png';

/* ============================================================================
   App chrome — Apple structure, Google affordances.

   A top app bar with a Google-style pill search, then pill navigation tabs
   whose selected state is impossible to miss. Content sits on Apple's tinted
   grouped background so every card reads as a distinct, touchable group.
   ============================================================================ */

export interface NavItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number;
  badgeTone?: 'dang' | 'warn' | 'neutral';
}

export interface NavGroup {
  heading?: string;
  items: NavItem[];
}

/* ------------------------------- theme ---------------------------------- */

type ThemeChoice = 'light' | 'dark' | 'system';

function useTheme(): [ThemeChoice, (t: ThemeChoice) => void, boolean] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      return (localStorage.getItem('timely_theme') as ThemeChoice) || 'system';
    } catch {
      return 'system';
    }
  });
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  );

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'system' ? mql.matches : choice === 'dark';
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      setIsDark(dark);
    };
    apply();
    try {
      localStorage.setItem('timely_theme', choice);
    } catch {
      /* private mode — the choice just will not persist */
    }
    if (choice !== 'system') return;
    mql.addEventListener('change', apply);
    return () => mql.removeEventListener('change', apply);
  }, [choice]);

  return [choice, setChoice, isDark];
}

/* ------------------------------- glyphs --------------------------------- */

const g = (cls = 'w-5 h-5') => ({
  className: cls,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

const SearchGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.6-4.6" /></svg>
);
const RefreshGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}>
    <path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.23L4.5 15.13" />
    <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.23l2.1 2.1" />
    <path d="M19.5 4.5v4.37h-4.37M4.5 19.5v-4.37h4.37" />
  </svg>
);
const SunGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" /></svg>
);
const MoonGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></svg>
);
const ChevronGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><path d="m6 9.5 6 6 6-6" /></svg>
);
const GearGlyph = ({ className }: { className?: string }) => (
  /* A real cog. The old version was a circle plus eight straight spokes, which
     at 17px read as a sun, not a settings control. */
  <svg {...g(className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.2 14.8a1.5 1.5 0 0 0 .3 1.65l.06.06a1.83 1.83 0 1 1-2.6 2.6l-.05-.06a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.91 1.37v.17a1.83 1.83 0 1 1-3.66 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.06a1.83 1.83 0 1 1-2.6-2.6l.06-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.91H4.2a1.83 1.83 0 1 1 0-3.66h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.06-.06a1.83 1.83 0 1 1 2.6-2.6l.05.06a1.5 1.5 0 0 0 1.65.3h.08a1.5 1.5 0 0 0 .91-1.37V4.2a1.83 1.83 0 1 1 3.66 0v.09a1.5 1.5 0 0 0 .91 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.06a1.83 1.83 0 1 1 2.6 2.6l-.06.05a1.5 1.5 0 0 0-.3 1.65v.08a1.5 1.5 0 0 0 1.37.91h.17a1.83 1.83 0 1 1 0 3.66h-.09a1.5 1.5 0 0 0-1.37.91z" />
  </svg>
);
const KeyGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><circle cx="8" cy="14" r="4" /><path d="m11 11 8-8M17 5l2 2M14.5 7.5l2 2" /></svg>
);
const LogoutGlyph = ({ className }: { className?: string }) => (
  <svg {...g(className)}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 8 6 12l4 4M6 12h10" /></svg>
);

/* ------------------------------ wordmark -------------------------------- */

const Wordmark = () => (
  <div className="flex items-center gap-3 select-none">
    <img src={shoriMark} alt="" aria-hidden="true" className="w-9 h-9 flex-none object-contain" />
    <span className="hidden sm:flex flex-col leading-none">
      <span className="text-[15.5px] font-extrabold tracking-[-0.03em] text-label whitespace-nowrap">
        Timely&nbsp;Payment
      </span>
      <span className="text-[11px] font-semibold tracking-[0.04em] uppercase text-label-3 mt-1 whitespace-nowrap">
        Shori Chemicals
      </span>
    </span>
  </div>
);

/* ------------------------------- menus ---------------------------------- */

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, close]);
  return ref;
}

const MENU_PANEL =
  'absolute right-0 top-[calc(100%+10px)] z-50 min-w-[248px] bg-card rounded-[16px] shadow-e3 py-2 overflow-hidden';
const MENU_ITEM =
  'w-full flex items-center gap-3 px-4 py-2.5 text-[14px] font-medium text-label-2 hover:text-label hover:bg-hover text-left transition-colors';

const IconButton = ({
  onClick,
  label,
  title,
  disabled,
  children,
}: {
  onClick?: () => void;
  label: string;
  title?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={title || label}
    className="w-10 h-10 grid place-items-center rounded-full text-label-2 hover:text-label hover:bg-hover active:bg-press transition-colors disabled:opacity-40"
  >
    {children}
  </button>
);

/* -------------------------------- shell --------------------------------- */

export interface AppShellProps {
  currentUser: User;
  groups: NavGroup[];
  activeKey: string;
  onNavigate: (key: string) => void;
  onLogout: () => void;

  title: string;
  subtitle?: React.ReactNode;
  headerActions?: React.ReactNode;

  searchTerm: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;

  onSync?: () => void;
  isSyncing?: boolean;
  /** Viewers can read everything and change nothing; say so rather than let them find out. */
  readOnly?: boolean;
  /** Opens the change-your-own-password dialog. */
  onChangePassword?: () => void;
  dataAsOf?: string;
  lastSyncTime?: string;

  banner?: React.ReactNode;
  /**
   * Hold the page to exactly one screen on a desktop, letting whatever the
   * page marks as its scrolling panel take the space that is left.
   *
   * Only from `lg` up. A phone cannot fit a dashboard without scrolling, and
   * pinning the body there would trap the content instead of showing it.
   */
  fitViewport?: boolean;
  children: React.ReactNode;
}

export const AppShell = ({
  currentUser,
  groups,
  activeKey,
  onNavigate,
  onLogout,
  title,
  subtitle,
  headerActions,
  searchTerm,
  onSearch,
  searchPlaceholder = 'Search customers, contacts, notes',
  onSync,
  isSyncing,
  readOnly,
  onChangePassword,
  dataAsOf,
  lastSyncTime,
  banner,
  fitViewport,
  children,
}: AppShellProps) => {
  const [choice, setTheme, isDark] = useTheme();
  const [userOpen, setUserOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const userRef = useDismiss(userOpen, () => setUserOpen(false));
  const setupRef = useDismiss(setupOpen, () => setSetupOpen(false));

  /**
   * When the book was last pulled, in words.
   *
   * Anyone looking at the dashboard wants one question answered — is this
   * today's data? A timestamp alone does not answer it at a glance, so say
   * "today" or "yesterday" where that is what it is, and mark anything older
   * than a day so a forgotten sync is visible rather than assumed.
   */
  const { syncedLabel, syncIsStale } = useMemo(() => {
    if (!lastSyncTime) return { syncedLabel: '', syncIsStale: false };
    const at = new Date(lastSyncTime);
    if (isNaN(at.getTime())) return { syncedLabel: '', syncIsStale: false };

    const midnight = (d: Date) => {
      const c = new Date(d);
      c.setHours(0, 0, 0, 0);
      return c.getTime();
    };
    const days = Math.round((midnight(new Date()) - midnight(at)) / 86400000);
    const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });

    const day =
      days <= 0 ? 'today' :
      days === 1 ? 'yesterday' :
      at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    return {
      syncedLabel: `Synced ${day}, ${time}`,
      syncIsStale: days >= 1,
    };
  }, [lastSyncTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el?.isContentEditable;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setSetupOpen(false), [activeKey]);

  const primary = groups[0]?.items ?? [];
  const setup = groups.slice(1).flatMap(gr => gr.items);
  const isSetupActive = setup.some(i => i.key === activeKey);

  return (
    <div className={cx(
      'min-h-screen bg-bg text-label',
      fitViewport && 'lg:h-dvh lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden',
    )}>
      {/* ================= app bar ================= */}
      <header className="sticky top-0 z-40 bg-card/90 backdrop-blur-xl border-b-[3px] border-brand-yellow">
        <div className="h-16 px-4 sm:px-6 flex items-center gap-3">
          <Wordmark />

          {/* Google-style pill search */}
          <div className="flex-1 flex justify-center px-2">
            <div className="relative w-full max-w-[520px]">
              <SearchGlyph className="w-[18px] h-[18px] absolute left-4 top-1/2 -translate-y-1/2 text-label-3 pointer-events-none" />
              <input
                ref={searchRef}
                value={searchTerm}
                onChange={e => onSearch(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label="Search"
                className="w-full h-11 pl-12 pr-12 rounded-full bg-card-3 border border-transparent text-[14px] text-label placeholder:text-label-3 focus:bg-card focus:border-accent focus:shadow-e2 outline-none transition-all"
              />
              {searchTerm ? (
                <button
                  onClick={() => onSearch('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover transition-colors text-[17px] leading-none"
                >
                  &times;
                </button>
              ) : (
                <kbd className="hidden md:flex absolute right-3.5 top-1/2 -translate-y-1/2 items-center h-6 px-2 text-[11px] font-semibold text-label-3 bg-card rounded-full pointer-events-none">
                  &#8984;K
                </kbd>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {onSync && (
              <IconButton
                onClick={onSync}
                disabled={isSyncing}
                label={isSyncing ? 'Syncing' : 'Sync from Google Sheets'}
                title={lastSyncTime ? `Last synced ${new Date(lastSyncTime).toLocaleString('en-IN')}` : 'Sync from Google Sheets'}
              >
                {isSyncing ? <Spinner className="w-[18px] h-[18px]" /> : <RefreshGlyph className="w-[18px] h-[18px]" />}
              </IconButton>
            )}

            <IconButton
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={`${isDark ? 'Light' : 'Dark'} mode${choice === 'system' ? ' (following system)' : ''}`}
            >
              {isDark ? <SunGlyph className="w-[18px] h-[18px]" /> : <MoonGlyph className="w-[18px] h-[18px]" />}
            </IconButton>

            <div className="relative ml-1" ref={userRef}>
              <button
                onClick={() => setUserOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={userOpen}
                className="flex items-center gap-2 h-10 pl-1 pr-2 rounded-full hover:bg-hover transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-accent text-on-accent grid place-items-center text-[12px] font-bold flex-none ring-2 ring-brand-yellow/70">
                  {initials(currentUser.name)}
                </span>
                <span className="hidden lg:block text-[14px] font-semibold text-label-2 max-w-[110px] truncate">
                  {currentUser.name}
                </span>
                <ChevronGlyph className="w-4 h-4 text-label-3 hidden lg:block" />
              </button>

              {userOpen && (
                <div role="menu" className={MENU_PANEL}>
                  <div className="px-4 py-3 flex items-center gap-3 border-b border-separator">
                    <span className="w-11 h-11 rounded-full bg-accent text-on-accent grid place-items-center text-[15px] font-bold flex-none">
                      {initials(currentUser.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-bold text-label truncate">{currentUser.name}</p>
                      <p className="text-[12.5px] text-label-3 mt-0.5 truncate">
                        {currentUser.role}
                        {currentUser.assignedCrms?.length ? ` · ${currentUser.assignedCrms.join(', ')}` : ''}
                      </p>
                    </div>
                  </div>

                  {readOnly && (
                    <p className="px-4 py-2 text-[12.5px] text-label-3 border-b border-separator">
                      Read-only access
                    </p>
                  )}

                  {onChangePassword && (
                    <button
                      role="menuitem"
                      onClick={() => {
                        setUserOpen(false);
                        onChangePassword();
                      }}
                      className={cx(MENU_ITEM, 'mt-1')}
                    >
                      <KeyGlyph className="w-[18px] h-[18px]" />
                      Change password
                    </button>
                  )}

                  <button role="menuitem" onClick={onLogout} className={cx(MENU_ITEM)}>
                    <LogoutGlyph className="w-[18px] h-[18px]" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ================= pill tabs ================= */}
        {/* No overflow-x here: it makes overflow-y compute to auto, which clipped
            the Settings dropdown to the height of this bar. Wrap instead. */}
        <nav className="px-4 sm:px-6 pb-2.5 flex items-center gap-1.5 flex-wrap" aria-label="Sections">
          {primary.map(item => {
            const active = item.key === activeKey;
            return (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                aria-current={active ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-2 h-9 px-4 rounded-full text-[14px] whitespace-nowrap transition-all duration-150',
                  active
                    ? 'bg-accent text-on-accent font-bold shadow-e1'
                    : 'text-label-2 font-medium hover:bg-hover hover:text-label'
                )}
              >
                {item.label}
                {item.badge != null && item.badge > 0 && (
                  <span
                    className={cx(
                      'num text-[11.5px] font-bold leading-none px-1.5 py-[3px] rounded-full',
                      item.badgeTone === 'dang'
                        ? 'bg-dang text-card'
                        : item.badgeTone === 'warn'
                        ? 'bg-warn text-card'
                        : active
                        ? 'bg-brand-yellow text-brand-yellow-ink'
                        : 'bg-card-3 text-label-3'
                    )}
                  >
                    {item.badge > 999 ? '999+' : item.badge}
                  </span>
                )}
              </button>
            );
          })}

          <div className="flex-1" />

          {setup.length > 0 && (
            <div className="relative" ref={setupRef}>
              <button
                onClick={() => setSetupOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={setupOpen}
                className={cx(
                  'flex items-center gap-2 h-9 px-4 rounded-full text-[14px] whitespace-nowrap transition-all duration-150',
                  isSetupActive
                    ? 'bg-accent text-on-accent font-bold shadow-e1'
                    : 'text-label-2 font-medium hover:bg-hover hover:text-label'
                )}
              >
                <GearGlyph className="w-[17px] h-[17px]" />
                <span className="hidden sm:inline">Settings</span>
              </button>
              {setupOpen && (
                <div role="menu" className={MENU_PANEL}>
                  {setup.map(item => (
                    <button
                      key={item.key}
                      role="menuitem"
                      onClick={() => onNavigate(item.key)}
                      className={cx(MENU_ITEM, item.key === activeKey && 'text-accent bg-accent-tint')}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
      </header>

      {banner}

      {/* ================= page heading (Apple large title) ================= */}
      <div className={cx(
        'px-4 sm:px-6 pt-8 pb-6',
        // A page held to one screen spends its height on content, not on the
        // gap above the title.
        fitViewport && 'lg:pt-4 lg:pb-3',
      )}>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-[32px] sm:text-[36px] font-extrabold text-label tracking-[-0.035em] leading-[1.05]">
              {title}
            </h1>
            {(subtitle || dataAsOf || lastSyncTime) && (
              <div className="flex items-center gap-2.5 flex-wrap mt-3 text-[14px] text-label-3">
                {subtitle}
                {dataAsOf && (
                  <>
                    {subtitle && <span className="w-1 h-1 rounded-full bg-label-3" aria-hidden="true" />}
                    <span>Book as of {dataAsOf}</span>
                  </>
                )}
                {/* "Book as of" is the date the spreadsheet says its figures run
                    to — it does not move when you press Sync, which left no way
                    to tell a fresh pull from a stale one. State the pull. */}
                {syncedLabel && (
                  <>
                    {(subtitle || dataAsOf) && <span className="w-1 h-1 rounded-full bg-label-3" aria-hidden="true" />}
                    <span className={syncIsStale ? 'text-warn font-semibold' : 'text-pos font-semibold'}>
                      {syncedLabel}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          {headerActions && <div className="flex items-center gap-2 flex-wrap">{headerActions}</div>}
        </div>
      </div>

      <main className={cx(
        'px-4 sm:px-6 pb-24',
        fitViewport && 'lg:flex-1 lg:min-h-0 lg:overflow-hidden lg:pb-5',
      )}>{children}</main>
    </div>
  );
};

export default AppShell;
