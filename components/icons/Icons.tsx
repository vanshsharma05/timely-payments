import React from 'react';

export { AppLogo } from './AppLogo';

/**
 * One stroke-based icon system (Heroicons v2 outline geometry).
 *
 * Every icon takes `className` and defaults to `w-5 h-5`, so icons sitting side
 * by side in a tab bar or a button row are the same optical size. Previously
 * some were hardcoded to `w-6 h-6` and others took no props at all, which is
 * why the tab bar had mismatched icon sizes.
 */
type IconProps = { className?: string };

const Svg = ({ className = 'w-5 h-5', children }: IconProps & { children: React.ReactNode }) => (
    <svg
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
    >
        {children}
    </svg>
);

export const DollarSignIcon = ({ className = 'w-6 h-6' }: IconProps) => (
    <Svg className={className}>
        <path d="M12 6v12m3-9.75c0-.83-1.34-1.5-3-1.5s-3 .67-3 1.5 1.34 1.5 3 1.5 3 .67 3 1.5-1.34 1.5-3 1.5-3-.67-3-1.5" />
        <circle cx="12" cy="12" r="9" />
    </Svg>
);

export const CheckCircleIcon = ({ className = 'w-6 h-6' }: IconProps) => (
    <Svg className={className}>
        <path d="M9 12.75 11.25 15 15 9.75" />
        <circle cx="12" cy="12" r="9" />
    </Svg>
);

export const ClockIcon = ({ className = 'w-6 h-6' }: IconProps) => (
    <Svg className={className}>
        <path d="M12 6.75V12l3.75 2.25" />
        <circle cx="12" cy="12" r="9" />
    </Svg>
);

export const UsersIcon = ({ className = 'w-6 h-6' }: IconProps) => (
    <Svg className={className}>
        <path d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.34 9.34 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.32 12.32 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </Svg>
);

export const DownloadIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </Svg>
);

export const UploadIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M7.5 7.5 12 3m0 0 4.5 4.5M12 3v13.5" />
    </Svg>
);

export const WhatsAppIcon = ({ className = 'w-5 h-5 mr-2' }: IconProps) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M12.04 2.01C6.58 2.01 2.13 6.46 2.13 12c0 1.77.46 3.45 1.29 4.93L2.01 22l5.24-1.4c1.43.78 3.05 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91s-4.45-9.9-9.91-9.9zM12.04 20.14h-.01c-1.55 0-3.04-.42-4.33-1.16l-.31-.18-3.22.84.86-3.14-.2-.33c-.83-1.35-1.28-2.91-1.28-4.52 0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24zm4.52-6.15c-.25-.12-1.47-.72-1.7-.81-.23-.09-.39-.12-.56.12-.17.25-.64.81-.79.97s-.29.19-.54.06c-.25-.12-1.06-.39-2.02-1.25-.75-.66-1.25-1.48-1.4-1.73s-.03-.38.09-.5c.11-.11.25-.29.37-.43s.17-.25.25-.42.04-.32-.02-.45c-.06-.12-.56-1.34-.76-1.84s-.4-.42-.56-.42h-.48c-.17 0-.45.06-.68.32s-.89.87-.89 2.12.92 2.46 1.04 2.64c.12.17 1.79 2.74 4.33 3.82.6.25 1.07.41 1.42.52.59.19 1.13.16 1.56.1.48-.06 1.47-.6 1.67-1.18s.21-1.09.15-1.18c-.06-.09-.12-.15-.25-.21z" />
    </svg>
);

export const CalendarIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0V11.25a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
    </Svg>
);

export const UserPlusIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M18 7.5v6m3-3h-6m-1.5 10.5v-1.5a4.5 4.5 0 0 0-4.5-4.5h-1.5a4.5 4.5 0 0 0-4.5 4.5V21M11.25 7.5a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </Svg>
);

export const FireIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M15.362 5.214A8.25 8.25 0 0 1 12 21a8.25 8.25 0 0 1-3.362-15.786A.75.75 0 0 1 9.75 6c0 2.25 1.5 3 1.5 3s.75-2.25.75-4.5c0-1.06.75-1.94 1.5-1.5.9.53 1.5 1.35 1.862 2.214Z" />
        <path d="M12 18a3 3 0 0 0 2.25-4.99A3 3 0 0 1 12 18a3 3 0 0 1-2.25-4.99A3 3 0 0 0 12 18Z" />
    </Svg>
);

/**
 * Circular-arrows refresh mark. The old one drew two open "L" corners that never
 * met the arcs, so it read as a broken squiggle at 20px.
 */
export const SyncIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.23L4.5 15.13" />
        <path d="M4.5 12a7.5 7.5 0 0 1 12.9-5.23l2.1 2.1" />
        <path d="M19.5 4.5v4.37h-4.37M4.5 19.5v-4.37h4.37" />
    </Svg>
);

export const EditIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </Svg>
);

export const TrashIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673A2.25 2.25 0 0 1 15.916 21.75H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.1 48.1 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.1 48.1 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.96 51.96 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </Svg>
);

/** An actual bar chart. The old path drew an upward arrow, which is why the
 *  Overview and Reports tabs showed the same "upload" glyph. */
export const ChartBarIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M3 20.25h18M6.75 20.25v-6.75m4.5 6.75V7.5m4.5 12.75v-9.75m4.5 9.75V4.5" />
    </Svg>
);

/** Distinct mark for the Reports tab so it no longer duplicates Overview. */
export const DocumentChartBarIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m2.25 0H5.625A1.125 1.125 0 0 0 4.5 3.375v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        <path d="M8.25 18v-3m3.75 3v-6m3.75 6v-1.5" />
    </Svg>
);

/** A real chain link. The old middle path was four sub-pixel dots. */
export const LinkIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757" />
        <path d="M10.81 15.312a4.5 4.5 0 0 1-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757" />
    </Svg>
);

export const DocumentTextIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5A3.375 3.375 0 0 0 10.125 2.25H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625A1.125 1.125 0 0 0 4.5 3.375v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </Svg>
);

/** A clipboard with list rows. The old path was a filled rounded rectangle, so
 *  it rendered as a solid block with the list strokes invisible inside it. */
export const ClipboardListIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M9 12h6m-6 3.75h6M9 4.5h6a1.5 1.5 0 0 1 1.5 1.5v.75h1.125c.621 0 1.125.504 1.125 1.125v12A1.125 1.125 0 0 1 18.375 21H5.625A1.125 1.125 0 0 1 4.5 19.875v-12c0-.621.504-1.125 1.125-1.125H6.75V6A1.5 1.5 0 0 1 8.25 4.5H9Z" />
        <path d="M9 6.75h6" />
    </Svg>
);

export const ExclamationTriangleIcon = ({ className = 'w-6 h-6' }: IconProps) => (
    <Svg className={className}>
        <path d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.91 18.5A1.75 1.75 0 0 0 3.42 21.13h17.16a1.75 1.75 0 0 0 1.51-2.63L13.66 3.94a1.75 1.75 0 0 0-3.02 0Z" />
    </Svg>
);

export const ChequeIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M2.25 8.25h19.5M2.25 9V7.5a2.25 2.25 0 0 1 2.25-2.25h15A2.25 2.25 0 0 1 21.75 7.5v9a2.25 2.25 0 0 1-2.25 2.25h-15A2.25 2.25 0 0 1 2.25 16.5V9Z" />
        <path d="M6 13.5h3m3 0h.75" />
    </Svg>
);

export const CheckSquareIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M9 12.75 11.25 15 15 9.75M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25V6.75Z" />
    </Svg>
);

export const BuildingOfficeIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M3.75 21h16.5M4.5 3h9.75c.414 0 .75.336.75.75V21H4.5V3.75c0-.414.336-.75.75-.75Zm10.5 6h3.75c.414 0 .75.336.75.75V21H15V9Z" />
        <path d="M7.5 6.75h.008m2.992 0h.008M7.5 10.5h.008m2.992 0h.008M7.5 14.25h.008m2.992 0h.008" />
    </Svg>
);

export const SparklesIcon = ({ className }: IconProps) => (
    <Svg className={className}>
        <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </Svg>
);
