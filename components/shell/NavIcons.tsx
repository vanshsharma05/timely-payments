interface IconProps {
  className?: string;
}

const base = (className = 'w-[18px] h-[18px]') => ({
  className,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const TodayIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
  </svg>
);

export const BookIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
    <path d="M8.5 7.5h7M8.5 11h4.5" />
  </svg>
);

export const ChequeNavIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M2.5 10h19M6 14.5h3M12.5 14.5h5.5" />
  </svg>
);

export const ChartIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 20V4" />
    <path d="M4 20h16" />
    <path d="M8 20v-6M13 20V9M18 20v-9" />
  </svg>
);

export const TeamIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 5.5a3.2 3.2 0 0 1 0 6.2M17.5 20a6 6 0 0 0-2.2-4.6" />
  </svg>
);

export const MessageIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M20 12.5c0 3.9-3.6 7-8 7a9 9 0 0 1-2.6-.4L4 21l1.4-3.8A6.7 6.7 0 0 1 4 12.5c0-3.9 3.6-7 8-7s8 3.1 8 7z" />
    <path d="M9 11.5h6M9 14h3.5" />
  </svg>
);

export const PlugIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M9 3v5M15 3v5" />
    <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 17v4" />
  </svg>
);

export const BuildingIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M4 21V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v15" />
    <path d="M15 10h3a2 2 0 0 1 2 2v9" />
    <path d="M2.5 21h19M8 8h2M8 12h2M8 16h2" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m20 20-4.5-4.5" />
  </svg>
);

export const RefreshIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
    <path d="M20.5 4v5h-5" />
  </svg>
);

export const SunIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
  </svg>
);

export const MoonIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" />
  </svg>
);

export const CloseIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);

export const LogoutIcon = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8 6 12l4 4M6 12h10" />
  </svg>
);

export const ChevronDown = ({ className }: IconProps) => (
  <svg {...base(className)}>
    <path d="m6 9.5 6 6 6-6" />
  </svg>
);
