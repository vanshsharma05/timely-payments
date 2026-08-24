import React, { useState } from 'react';
import { User } from '../types';
import { AppLogo } from './icons/AppLogo';

interface LoginScreenProps {
    users: User[];
    onLogin: (user: User) => void;
    onResetPassword?: (userId: string, newPassword: string) => void;
    onResetAll?: () => void;
}

const LoginScreen = ({ users, onLogin, onResetPassword, onResetAll }: LoginScreenProps) => {
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [isResetModalOpen, setIsResetModalOpen] = useState(false);
    const [resetTargetUser, setResetTargetUser] = useState<string>(users[0]?.id || 'Admin');
    const [newPasswordInput, setNewPasswordInput] = useState('');

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedUserId) {
            setError('Please select your user account to sign in.');
            return;
        }
        const user = users.find(u => u.id === selectedUserId);
        if (user && user.password === password) {
            onLogin(user);
        } else {
            setError('Invalid password. Please check your credentials or click "Reset Password".');
            setSuccessMessage('');
        }
    };

    const handlePerformReset = (targetId: string, customNewPass?: string) => {
        const passToSet = customNewPass && customNewPass.trim() ? customNewPass.trim() : (targetId === 'Admin' ? 'admin' : 'password123');
        if (onResetPassword) {
            onResetPassword(targetId, passToSet);
        }
        setPassword(passToSet);
        setSelectedUserId(targetId);
        setError('');
        setSuccessMessage(`Password for "${targetId}" has been reset to: "${passToSet}". You can now sign in.`);
        setIsResetModalOpen(false);
        setNewPasswordInput('');
    };

    const selectedUser = users.find(u => u.id === selectedUserId);

    return (
        <div className="min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800">
                <div className="bg-gradient-to-br from-emerald-700 via-green-600 to-teal-700 p-8 text-center relative overflow-hidden">
                    <div className="inline-flex items-center justify-center p-3.5 bg-white rounded-2xl shadow-lg mb-4 ring-4 ring-white/20">
                        <AppLogo className="w-14 h-14" variant="full-color" />
                    </div>
                    <h1 className="text-3xl font-extrabold text-white tracking-tight">Timely Payment</h1>
                    <p className="text-green-100 mt-1.5 text-base font-medium">Collection & Follow-up System</p>
                </div>
                
                <div className="p-8">
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6 text-center">Sign In to Your Account</h2>
                    
                    <form onSubmit={handleLogin} className="space-y-5">
                        <div>
                            <label htmlFor="user" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Select User</label>
                            <div className="relative">
                                <select
                                    id="user"
                                    value={selectedUserId}
                                    onChange={(e) => {
                                        setSelectedUserId(e.target.value);
                                        setError('');
                                    }}
                                    className="block w-full pl-3 pr-10 py-3 text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 sm:text-sm rounded-xl bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-white shadow-xs transition-colors font-medium"
                                >
                                    <option value="" disabled>-- Select Your Account --</option>
                                    {users.map((user) => (
                                        <option key={user.id} value={user.id}>
                                            {user.name} ({user.role})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-1.5">
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Password</label>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setResetTargetUser(selectedUserId || 'Admin');
                                        setIsResetModalOpen(true);
                                    }}
                                    className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline transition-colors"
                                >
                                    🔑 Reset Password
                                </button>
                            </div>
                            <input
                                id="password"
                                name="password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => {
                                    setPassword(e.target.value);
                                    setError('');
                                    setSuccessMessage('');
                                }}
                                className="appearance-none block w-full px-4 py-3 border border-gray-300 placeholder-gray-400 text-gray-900 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent focus:z-10 sm:text-sm dark:bg-gray-800 dark:border-gray-700 dark:text-white shadow-xs transition-all"
                                placeholder="Enter your password"
                            />
                        </div>

                        {error && (
                            <div className="text-red-600 text-xs text-center bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800 font-medium">
                                {error}
                            </div>
                        )}

                        {successMessage && (
                            <div className="text-emerald-700 dark:text-emerald-300 text-xs text-center bg-emerald-50 dark:bg-emerald-950/40 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 font-semibold">
                                ✓ {successMessage}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent text-sm font-bold rounded-xl text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 shadow-md transition-all hover:shadow-lg active:scale-[0.99]"
                        >
                            Sign In to Dashboard
                        </button>

                        {onResetAll && (
                            <div className="pt-4 mt-4 border-t border-gray-100 dark:border-gray-800 text-center">
                                <button
                                    type="button"
                                    onClick={onResetAll}
                                    className="text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors inline-flex items-center gap-1 font-semibold"
                                >
                                    🔄 Reset All Data & Start Fresh
                                </button>
                            </div>
                        )}
                    </form>
                </div>
            </div>

            {/* Reset Password Modal */}
            {isResetModalOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                <span>🔑</span>
                                <span>Reset Password</span>
                            </h3>
                            <button
                                type="button"
                                onClick={() => setIsResetModalOpen(false)}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl font-bold p-1"
                            >
                                ✕
                            </button>
                        </div>

                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                            Select an account to reset its password back to default or specify a new custom password.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                    Target Account
                                </label>
                                <select
                                    value={resetTargetUser}
                                    onChange={(e) => setResetTargetUser(e.target.value)}
                                    className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white font-medium"
                                >
                                    {users.map((u) => (
                                        <option key={u.id} value={u.id}>
                                            {u.name} ({u.role})
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                    New Password (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={newPasswordInput}
                                    onChange={(e) => setNewPasswordInput(e.target.value)}
                                    placeholder={resetTargetUser === 'Admin' ? 'Leave empty to reset to "admin"' : 'Leave empty to reset to "password123"'}
                                    className="block w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                                />
                            </div>

                            <div className="pt-2 flex flex-col sm:flex-row gap-2">
                                <button
                                    type="button"
                                    onClick={() => handlePerformReset(resetTargetUser, newPasswordInput)}
                                    className="flex-1 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow transition-colors text-center"
                                >
                                    {newPasswordInput.trim() ? `Set New Password` : `Reset to Default (${resetTargetUser === 'Admin' ? '"admin"' : '"password123"'})`}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsResetModalOpen(false)}
                                    className="py-2.5 px-4 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-bold rounded-xl transition-colors text-center"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoginScreen;