
import { ExclamationTriangleIcon } from './icons/Icons';

interface NotificationBannerProps {
    urgentCount: number;
    overdueCount: number;
    onDismiss: () => void;
    onView?: () => void;
}

const NotificationBanner = ({ urgentCount, overdueCount, onView, onDismiss }: NotificationBannerProps) => {
    const hasUrgent = urgentCount > 0;
    const bannerClasses = hasUrgent 
        ? 'bg-red-50 dark:bg-red-900/30 border-red-500 text-red-800 dark:text-red-200'
        : 'bg-yellow-50 dark:bg-yellow-900/30 border-yellow-500 text-yellow-800 dark:text-yellow-200';
    
    const viewButtonClasses = hasUrgent
        ? 'bg-red-600 hover:bg-red-700 text-white'
        : 'bg-yellow-600 hover:bg-yellow-700 text-white';

    let message = '';
    if (urgentCount > 0 && overdueCount > 0) {
        message = `You have ${urgentCount} urgent task${urgentCount > 1 ? 's' : ''} and ${overdueCount} overdue payment${overdueCount > 1 ? 's' : ''}.`;
    } else if (urgentCount > 0) {
        message = `You have ${urgentCount} urgent task${urgentCount > 1 ? 's' : ''} that require immediate attention.`;
    } else if (overdueCount > 0) {
        message = `You have ${overdueCount} overdue payment${overdueCount > 1 ? 's' : ''} to follow up on.`;
    }

    if (!message) return null;

    return (
        <div className={`mb-6 p-4 rounded-lg border-l-4 shadow-md flex items-center justify-between ${bannerClasses}`} role="alert">
            <div className="flex items-center">
                <ExclamationTriangleIcon className={`w-6 h-6 mr-3 ${hasUrgent ? 'text-red-500' : 'text-yellow-500'}`} />
                <span className="font-medium">{message}</span>
            </div>
            <div className="flex items-center space-x-4">
                {onView && (
                    <button onClick={onView} className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${viewButtonClasses}`}>
                        View Items
                    </button>
                )}
                <button onClick={onDismiss} aria-label="Dismiss" className="text-current opacity-70 hover:opacity-100">
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default NotificationBanner;
