import React, { useState, useEffect } from 'react';
import { User, UserRole, DataVisibility, UserPermissions, DEFAULT_ROLE_PERMISSIONS } from '../types';

interface UserModalProps {
    userToEdit: User | null;
    onSave: (user: Omit<User, 'id'> & { id?: string }) => void;
    onClose: () => void;
    existingCrms?: string[];
}

const KNOWN_CRMS = ['ANKUR', 'PRIKSHIT', 'VISHNU', 'POONAM', 'SANDEEP', 'KAPIL', 'SAVIA', 'ROHINI', 'GARRY'];

const UserModal = ({ userToEdit, onSave, onClose, existingCrms = KNOWN_CRMS }: UserModalProps) => {
    const [name, setName] = useState('');
    const [role, setRole] = useState<UserRole>(UserRole.CRM);
    const [password, setPassword] = useState('');
    const [dataVisibility, setDataVisibility] = useState<DataVisibility>(DataVisibility.AssignedOnly);
    const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]);
    const [assignedCrms, setAssignedCrms] = useState<string[]>([]);
    const [customCrmInput, setCustomCrmInput] = useState('');

    useEffect(() => {
        if (userToEdit) {
            setName(userToEdit.name);
            setRole(userToEdit.role);
            setPassword(''); // Don't pre-fill password
            setDataVisibility(userToEdit.dataVisibility || (userToEdit.role === UserRole.Admin ? DataVisibility.All : DataVisibility.AssignedOnly));
            setPermissions(userToEdit.permissions || DEFAULT_ROLE_PERMISSIONS[userToEdit.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]);
            setAssignedCrms(userToEdit.assignedCrms || (userToEdit.role === UserRole.CRM ? [userToEdit.id] : []));
        } else {
            setName('');
            setRole(UserRole.CRM);
            setPassword('');
            setDataVisibility(DataVisibility.AssignedOnly);
            setPermissions(DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]);
            setAssignedCrms([]);
        }
    }, [userToEdit]);

    // When role changes, preset the default permissions
    const handleRoleChange = (newRole: UserRole) => {
        setRole(newRole);
        const defaultPerms = DEFAULT_ROLE_PERMISSIONS[newRole];
        setPermissions(defaultPerms);
        if (newRole === UserRole.Admin || newRole === UserRole.Manager || newRole === UserRole.Viewer) {
            setDataVisibility(DataVisibility.All);
        } else {
            setDataVisibility(DataVisibility.AssignedOnly);
        }
    };

    const handlePermissionToggle = (key: keyof UserPermissions) => {
        setPermissions(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    const handleToggleCrm = (crm: string) => {
        setAssignedCrms(prev => {
            const upper = crm.trim().toUpperCase();
            if (prev.includes(upper)) {
                return prev.filter(c => c !== upper);
            } else {
                return [...prev, upper];
            }
        });
    };

    const handleAddCustomCrm = () => {
        const val = customCrmInput.trim().toUpperCase();
        if (val && !assignedCrms.includes(val)) {
            setAssignedCrms(prev => [...prev, val]);
            setCustomCrmInput('');
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            alert('User name cannot be empty.');
            return;
        }
        if (!userToEdit && !password) {
            alert('Password is required for new users.');
            return;
        }

        const finalVisibility = role === UserRole.Admin ? DataVisibility.All : dataVisibility;

        onSave({
            id: userToEdit?.id,
            name: name.trim(),
            role,
            password: password.trim() ? password.trim() : undefined,
            dataVisibility: finalVisibility,
            permissions: {
                ...permissions,
                canViewAllCrms: finalVisibility === DataVisibility.All ? true : permissions.canViewAllCrms,
            },
            assignedCrms: assignedCrms.length > 0 ? assignedCrms : undefined,
        });
    };

    // Combine standard and custom CRM names
    const allCrmChoices = Array.from(new Set([...existingCrms, ...assignedCrms]));

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col border border-gray-200 dark:border-gray-800 animate-in fade-in zoom-in-95 duration-150 my-auto">
                {/* Header */}
                <div className="p-5 border-b border-gray-200 dark:border-gray-800 flex justify-between items-center bg-gray-50/50 dark:bg-gray-800/50 rounded-t-2xl">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                                                        <span>{userToEdit ? `Edit User: ${userToEdit.name}` : 'Add New User'}</span>
                        </h2>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            Configure user profile, role classification, customer access rights, and action permissions.
                        </p>
                    </div>
                    <button 
                        type="button" 
                        onClick={onClose} 
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl font-bold p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                     aria-label="Close">
                        &times;
                    </button>
                </div>

                {/* Body Form */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
                    {/* Basic Profile */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="userName" className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Full Name <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>
                            </label>
                            <input
                                id="userName"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Ankur Sharma"
                                className="w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-medium focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:text-white"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="userPassword" className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1">
                                Password {userToEdit ? <span className="text-gray-400 font-normal">(Leave blank to keep)</span> : <span className="text-red-600 dark:text-red-400" aria-hidden="true">*</span>}
                            </label>
                            <input
                                id="userPassword"
                                type="text"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={userToEdit ?"Keep existing password" :"Enter account password"}
                                className="w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-medium focus:ring-2 focus:ring-green-500 focus:border-green-500 text-gray-900 dark:text-white"
                            />
                        </div>
                    </div>

                    {/* Role Selection */}
                    <div>
                        <label htmlFor="userRole" className="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-1.5">
                            System Role & Preset
                        </label>
                        <select aria-label="System Role & Preset"
                            id="userRole"
                            value={role}
                            onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                            className="w-full border rounded-xl shadow-2xs bg-gray-50 dark:bg-gray-800 border-gray-300 dark:border-gray-700 p-2.5 text-sm font-bold text-gray-900 dark:text-white focus:ring-2 focus:ring-green-500"
                        >
                            <option value={UserRole.Admin}>Admin (Full unrestricted access & role management)</option>
                            <option value={UserRole.Manager}>Manager / Sales Head (Can view all CRMs, add/edit customers & PDC)</option>
                            <option value={UserRole.CRM}>CRM Account Owner (Manage assigned portfolio, follow-ups & add customers)</option>
                            <option value={UserRole.Collector}>Collection Executive (Follow-up collection notes & PDC entry)</option>
                            <option value={UserRole.Viewer}>Read-Only Viewer (View summary reports & data without editing)</option>
                        </select>
                    </div>

                    {/* Data Visibility / Scope */}
                    {role !== UserRole.Admin && (
                        <div className="p-3.5 bg-slate-50 dark:bg-gray-800/60 rounded-xl border border-slate-200 dark:border-gray-700/80">
                            <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider mb-2">
                                Customer Data Visibility
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <label className={`flex items-center p-2.5 rounded-lg border cursor-pointer transition-all ${dataVisibility === DataVisibility.AssignedOnly ? 'bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700 text-green-900 dark:text-green-200 font-bold' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs'}`}>
                                    <input 
                                        type="radio" 
                                        name="visibility" 
                                        value={DataVisibility.AssignedOnly} 
                                        checked={dataVisibility === DataVisibility.AssignedOnly} 
                                        onChange={() => setDataVisibility(DataVisibility.AssignedOnly)} 
                                        className="mr-2.5 text-green-600 dark:text-green-400 focus:ring-green-500"
                                    />
                                    <div>
                                        <div className="text-xs font-semibold">Assigned Portfolio Only</div>
                                        <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Only see own CRM / collector customer accounts</div>
                                    </div>
                                </label>
                                <label className={`flex items-center p-2.5 rounded-lg border cursor-pointer transition-all ${dataVisibility === DataVisibility.All ? 'bg-green-50 border-green-300 dark:bg-green-950/30 dark:border-green-700 text-green-900 dark:text-green-200 font-bold' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-xs'}`}>
                                    <input 
                                        type="radio" 
                                        name="visibility" 
                                        value={DataVisibility.All} 
                                        checked={dataVisibility === DataVisibility.All} 
                                        onChange={() => setDataVisibility(DataVisibility.All)} 
                                        className="mr-2.5 text-green-600 dark:text-green-400 focus:ring-green-500"
                                    />
                                    <div>
                                        <div className="text-xs font-semibold">All Company Customers</div>
                                        <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can view and filter across all CRM portfolios</div>
                                    </div>
                                </label>
                            </div>

                            {/* Assigned CRMs Multi-Select (For users with AssignedOnly scope) */}
                            {dataVisibility === DataVisibility.AssignedOnly && (
                                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                    <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                                        Assigned CRM Portfolios (Click to toggle):
                                    </label>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {allCrmChoices.map(crm => {
                                            const isSelected = assignedCrms.includes(crm.toUpperCase());
                                            return (
                                                <button
                                                    key={crm}
                                                    type="button"
                                                    onClick={() => handleToggleCrm(crm)}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                                                        isSelected
                                                            ? 'bg-green-600 text-white shadow-2xs'
                                                            : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-600 hover:bg-gray-100'
                                                    }`}
                                                >
                                                    {isSelected ? '✓ ' : '+ '}{crm}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={customCrmInput}
                                            onChange={e => setCustomCrmInput(e.target.value)}
                                            placeholder="Add custom CRM name (e.g. VIP_TEAM)"
                                            className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 flex-1"
                                        />
                                        <button
                                            type="button"
                                            onClick={handleAddCustomCrm}
                                            className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-bold rounded-lg text-gray-800 dark:text-gray-200"
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Granular Permissions Section */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-xs font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                                Granular User Rights & Capabilities
                            </label>
                            <span className="text-[11.5px] text-gray-500 dark:text-gray-400">
                                Customizable per user
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {/* Can Add Customer */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canAddCustomer ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canAddCustomer}
                                    onChange={() => handlePermissionToggle('canAddCustomer')}
                                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="font-bold">Add New Customers</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can create fresh customer master records</div>
                                </div>
                            </label>

                            {/* Can Edit Customer Master */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canEditCustomer ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canEditCustomer}
                                    onChange={() => handlePermissionToggle('canEditCustomer')}
                                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="font-bold">Edit Customer Info</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can update contacts, mobile, email, and designation</div>
                                </div>
                            </label>

                            {/* Can Edit Financials & Ageing */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canEditFinancials ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canEditFinancials}
                                    onChange={() => handlePermissionToggle('canEditFinancials')}
                                    className="w-4 h-4 mt-0.5 rounded text-amber-600 dark:text-amber-400 focus:ring-amber-500"
                                />
                                <div>
                                    <div className="font-bold">Edit Financial Amounts</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can modify total due & ageing breakdown</div>
                                </div>
                            </label>

                            {/* Can Log Follow-ups & Forecast */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canEditFollowUp ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canEditFollowUp}
                                    onChange={() => handlePermissionToggle('canEditFollowUp')}
                                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="font-bold">Log Follow-ups & Forecasts</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can record notes, dates, and cash targets</div>
                                </div>
                            </label>

                            {/* Can Manage PDC Cheques */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canManagePdc ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canManagePdc}
                                    onChange={() => handlePermissionToggle('canManagePdc')}
                                    className="mt-0.5 w-4 h-4 rounded text-emerald-600 dark:text-emerald-400 focus:ring-emerald-500"
                                />
                                <div>
                                    <div className="font-bold">Manage PDC Cheques</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can add, deposit, and clear post-dated cheques</div>
                                </div>
                            </label>

                            {/* Can Reassign CRM */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canReassignCrm ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700 text-blue-900 dark:text-blue-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canReassignCrm}
                                    onChange={() => handlePermissionToggle('canReassignCrm')}
                                    className="w-4 h-4 mt-0.5 rounded text-blue-600 dark:text-blue-400 focus:ring-blue-500"
                                />
                                <div>
                                    <div className="font-bold">Reassign CRM Owners</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can reallocate accounts between team members</div>
                                </div>
                            </label>

                            {/* Can Export Data */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canExportData ? 'bg-purple-50/70 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700 text-purple-900 dark:text-purple-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canExportData}
                                    onChange={() => handlePermissionToggle('canExportData')}
                                    className="w-4 h-4 mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                                />
                                <div>
                                    <div className="font-bold">Export Reports & Excel</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can download spreadsheet analysis</div>
                                </div>
                            </label>

                            {/* Can Delete Customer */}
                            <label className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer ${permissions.canDeleteCustomer ? 'bg-red-50/70 dark:bg-red-950/30 border-red-300 dark:border-red-700 text-red-900 dark:text-red-200 font-semibold' : 'bg-gray-50 dark:bg-gray-800/40 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}>
                                <input
                                    type="checkbox"
                                    checked={permissions.canDeleteCustomer}
                                    onChange={() => handlePermissionToggle('canDeleteCustomer')}
                                    className="w-4 h-4 mt-0.5 rounded text-red-600 dark:text-red-400 focus:ring-red-500"
                                />
                                <div>
                                    <div className="font-bold">Delete Customers</div>
                                    <div className="text-[11.5px] text-gray-500 dark:text-gray-400">Can permanently delete customer records</div>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-800 flex justify-end space-x-3">
                        <button 
                            type="button"
                            onClick={onClose} 
                            className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                         aria-label="Close">
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="px-5 py-2.5 text-sm font-bold rounded-xl bg-green-600 text-white hover:bg-green-700 shadow-md shadow-green-600/20 transition-all flex items-center gap-1.5"
                        >
                            <span>Save User & Rights</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UserModal;
