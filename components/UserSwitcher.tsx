
import { User } from '../types';

interface UserSwitcherProps {
    currentUser: User;
    onUserChange: (userId: string) => void;
    users: User[];
}

const UserSwitcher = ({ currentUser, onUserChange, users }: UserSwitcherProps) => {
    return (
        <div className="flex items-center space-x-2">
             <div className="w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            </div>
            <select
                value={currentUser.id}
                onChange={(e) => onUserChange(e.target.value)}
                className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-sm font-medium text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
                {users.map(user => (
                    <option key={user.id} value={user.id}>
                        {user.name} ({user.role})
                    </option>
                ))}
            </select>
        </div>
    );
};

export default UserSwitcher;