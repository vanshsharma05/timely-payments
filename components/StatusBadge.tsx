
import { FollowUpStatus } from '../types';

interface StatusBadgeProps {
    status: FollowUpStatus;
}

const StatusBadge = ({ status }: StatusBadgeProps) => {
    const statusStyles: { [key in FollowUpStatus]: string } = {
        [FollowUpStatus.Completed]: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        [FollowUpStatus.Today]: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
        [FollowUpStatus.Upcoming]: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        [FollowUpStatus.Pending]: 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
        [FollowUpStatus.Overdue]: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
    };
    
    const statusText = status.replace('_', ' ');

    return (
        <span className={`px-2.5 py-0.5 inline-flex text-xs leading-5 font-semibold rounded-full ${statusStyles[status]}`}>
            {statusText}
        </span>
    );
};

export default StatusBadge;