


export { AppLogo } from './AppLogo';

export const DollarSignIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8v1m0 6v1m6-1a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
);

export const CheckCircleIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
);

export const ClockIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
    </svg>
);

export const UsersIcon = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
    </svg>
);

export const DownloadIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
    </svg>
);

export const WhatsAppIcon = ({ className = "w-5 h-5 mr-2" }: { className?: string }) => (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.04 2.01C6.58 2.01 2.13 6.46 2.13 12c0 1.77.46 3.45 1.29 4.93L2.01 22l5.24-1.4c1.43.78 3.05 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91s-4.45-9.9-9.91-9.9zM12.04 20.14h-.01c-1.55 0-3.04-.42-4.33-1.16l-.31-.18-3.22.84.86-3.14-.2-.33c-.83-1.35-1.28-2.91-1.28-4.52 0-4.54 3.7-8.24 8.24-8.24 4.54 0 8.24 3.7 8.24 8.24s-3.7 8.24-8.24 8.24zm4.52-6.15c-.25-.12-1.47-.72-1.7-.81-.23-.09-.39-.12-.56.12-.17.25-.64.81-.79.97s-.29.19-.54.06c-.25-.12-1.06-.39-2.02-1.25-.75-.66-1.25-1.48-1.4-1.73s-.03-.38.09-.5c.11-.11.25-.29.37-.43s.17-.25.25-.42.04-.32-.02-.45c-.06-.12-.56-1.34-.76-1.84s-.4-.42-.56-.42h-.48c-.17 0-.45.06-.68.32s-.89.87-.89 2.12.92 2.46 1.04 2.64c.12.17 1.79 2.74 4.33 3.82.6.25 1.07.41 1.42.52.59.19 1.13.16 1.56.1.48-.06 1.47-.6 1.67-1.18s.21-1.09.15-1.18c-.06-.09-.12-.15-.25-.21z" />
    </svg>
);

export const CalendarIcon = () => (
    <svg className="w-5 h-5 mr-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
);

export const UserPlusIcon = ({ className = "w-5 h-5 mr-2 text-gray-500" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
);

export const FireIcon = ({className}: {className?: string}) => (
     <svg className={`w-5 h-5 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M12.963 2.286a.75.75 0 00-1.071 1.052A9.75 9.75 0 0110.305 8.25a.75.75 0 00-1.052-1.071A11.25 11.25 0 006.05 3.338a.75.75 0 00-1.052 1.071 9.75 9.75 0 013.303 5.467.75.75 0 001.43-.327 8.25 8.25 0 00-2.82-5.01A.75.75 0 006.666 5.25a11.25 11.25 0 00-2.62 6.096c0 5.422 4.133 9.932 9.467 10.589a.75.75 0 10.155-1.492c-4.832-.613-8.222-4.693-8.222-9.097 0-1.09.213-2.13.608-3.088A9.71 9.71 0 0112 12.375a9.71 9.71 0 013.302-6.088c.395.958.608 2 .608 3.088 0 4.404-3.39 8.484-8.222 9.097a.75.75 0 10.155 1.492c5.334-.657 9.467-5.167 9.467-10.59 0-2.642-1.013-5.07-2.73-6.932A.75.75 0 0012.963 2.286z" clipRule="evenodd" />
    </svg>
);

export const SyncIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h5M20 20v-5h-5M4 4l1.5 1.5A9 9 0 0120 12M20 20l-1.5-1.5A9 9 0 004 12"></path>
    </svg>
);

export const EditIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.586a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
    </svg>
);

export const TrashIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
    </svg>
);

export const ChartBarIcon = ({className}: {className?: string}) => (
     <svg className={`w-5 h-5 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 20.25a.75.75 0 01-.75-.75V6.31l-3.47 3.47a.75.75 0 01-1.06-1.06l5-5a.75.75 0 011.06 0l5 5a.75.75 0 11-1.06 1.06l-3.47-3.47v13.19a.75.75 0 01-.75.75z" />
        <path d="M3.375 19.5a.75.75 0 01.75-.75h15.75a.75.75 0 010 1.5H4.125a.75.75 0 01-.75-.75z" />
     </svg>
);

export const LinkIcon = ({className}: {className?: string}) => (
    <svg className={`w-5 h-5 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M8.25 10.875a2.625 2.625 0 113.712 3.712l-1.482 1.483a.75.75 0 01-1.06-1.06l1.482-1.483a1.125 1.125 0 00-1.59-1.59l-2.22 2.22a1.125 1.125 0 001.59 1.59l.859-.859a.75.75 0 011.06 1.06l-.86.86a2.625 2.625 0 11-3.712-3.712l2.22-2.22z" clipRule="evenodd" />
        <path fillRule="evenodd" d="M12.75 5.25a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75h-.01a.75.75 0 01-.75-.75V6a.75.75 0 01.75-.75zM10.5 8.25a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75h-.01a.75.75 0 01-.75-.75V9a.75.75 0 01.75-.75zm3.75 1.5a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75h-.01a.75.75 0 01-.75-.75v-.01a.75.75 0 01.75-.75zm-1.5 3.75a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75h-.01a.75.75 0 01-.75-.75v-.01a.75.75 0 01.75-.75z" clipRule="evenodd" />
        <path fillRule="evenodd" d="M15.75 10.875a2.625 2.625 0 10-3.712 3.712l1.482 1.483a.75.75 0 001.06-1.06l-1.482-1.483a1.125 1.125 0 011.59-1.59l2.22 2.22a1.125 1.125 0 01-1.59 1.59l-.859-.859a.75.75 0 00-1.06 1.06l.86.86a2.625 2.625 0 103.712-3.712l-2.22-2.22z" clipRule="evenodd" />
    </svg>
);

export const DocumentTextIcon = ({className}: {className?: string}) => (
    <svg className={`w-5 h-5 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a.375.375 0 01-.375-.375V6.75A3.75 3.75 0 0010.5 3h-4.875c0-1.036.84-1.875 1.875-1.875zM12.75 6a.75.75 0 00-1.5 0v6a.75.75 0 001.5 0V6z" clipRule="evenodd" />
        <path d="M10.5 3A3.75 3.75 0 006.75 6.75v1.5c0 .207.168.375.375.375h1.875v-1.875c0-1.036.84-1.875 1.875-1.875h1.875A3.75 3.75 0 0010.5 3z" />
        <path d="M16.5 9a3.75 3.75 0 00-3.75-3.75v1.875c0 .207.168.375.375.375h1.5A3.75 3.75 0 0016.5 9z" />
    </svg>
);

export const ClipboardListIcon = ({className}: {className?: string}) => (
    <svg className={`w-5 h-5 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path d="M4.5 3.75a3 3 0 00-3 3v10.5a3 3 0 003 3h15a3 3 0 003-3V6.75a3 3 0 00-3-3h-15z" />
        <path fillRule="evenodd" d="M8.25 7.5a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0v-6a.75.75 0 01.75-.75zM12 7.5a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0v-6A.75.75 0 0112 7.5zm3.75 0a.75.75 0 01.75.75v6a.75.75 0 01-1.5 0v-6a.75.75 0 01.75-.75z" clipRule="evenodd" />
    </svg>
);

export const UploadIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
    </svg>
);

export const ExclamationTriangleIcon = ({className}: {className?: string}) => (
    <svg className={`w-6 h-6 ${className}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" d="M11.996 2.003c.813 0 1.512.433 1.89 1.135l8.132 15.053a1.95 1.95 0 01-1.696 2.812H3.67c-.982 0-1.808-.71-1.93-1.688a1.95 1.95 0 01.234-1.124l8.132-15.053A1.95 1.95 0 0111.996 2.003zM12 16.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm-1.5-6a1.5 1.5 0 001.5 1.5h.008a1.5 1.5 0 000-3H12a1.5 1.5 0 00-1.5 1.5z" clipRule="evenodd" />
    </svg>
);

export const ChequeIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"></path>
    </svg>
);

export const CheckSquareIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path>
    </svg>
);

export const BuildingOfficeIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
    </svg>
);

export const SparklesIcon = ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.286L13 21l-2.286-6.857L5 12l5.714-2.286L13 3z"></path>
    </svg>
);

