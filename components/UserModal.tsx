import React, { useState, useEffect } from 'react';
import { User, UserRole, DataVisibility, UserPermissions, TeamMemberDraft, DEFAULT_ROLE_PERMISSIONS } from '../types';
import { DialogShell } from './ui/DialogShell';
import { Button, cx } from './ui/Primitives';
import { FIELD, LABEL } from './ui/fields';

interface UserModalProps {
    userToEdit: User | null;
    /**
     * Creates or updates the real account. Rejecting keeps the modal open and
     * shows the reason, so a failed save is never mistaken for a saved one.
     */
    onSave: (user: TeamMemberDraft) => void | Promise<void>;
    onClose: () => void;
    existingCrms?: string[];
}

/** 'Ankur Sharma' -> 'ANKUR_SHARMA', the shape CRM codes take in the sheet. */
const toCrmCode = (value: string) =>
    value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Same alphabet, but applied while typing — so it must not trim the edges, or
 * an underscore could never be typed in the middle of a code.
 */
const typeCrmCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9_]+/g, '_');

/** Each role, and what it stands for. The preset it applies is in DEFAULT_ROLE_PERMISSIONS. */
const ROLE_CHOICES: { role: UserRole; label: string; hint: string }[] = [
    { role: UserRole.Admin, label: 'Admin', hint: 'Everything, including the team and the data source.' },
    { role: UserRole.Manager, label: 'Manager / sales head', hint: 'The whole book: adds and edits customers and cheques, reports across every CRM.' },
    { role: UserRole.CRM, label: 'CRM account owner', hint: 'Their own portfolio: follow-ups, new customers, cheques.' },
    { role: UserRole.Collector, label: 'Collection executive', hint: 'Follow-up notes and cheque entry on the accounts they are assigned.' },
    { role: UserRole.Viewer, label: 'Read-only viewer', hint: 'Reads summaries and reports; changes nothing.' },
];

const SCOPE_CHOICES: { value: DataVisibility; label: string; hint: string }[] = [
    { value: DataVisibility.AssignedOnly, label: 'Assigned portfolios only', hint: 'The accounts owned by the CRM codes chosen below.' },
    { value: DataVisibility.All, label: 'Every account', hint: 'The whole book, filterable by CRM.' },
];

/** Every right the form can grant, in the order the Team table lists them. */
const RIGHT_CHOICES: { key: keyof UserPermissions; label: string; hint: string; danger?: boolean }[] = [
    { key: 'canAddCustomer', label: 'Add customers', hint: 'Create new customer accounts.' },
    { key: 'canEditCustomer', label: 'Edit customer details', hint: 'Contacts, mobile, email and designation.' },
    { key: 'canEditFinancials', label: 'Edit financial amounts', hint: 'The total due and the ageing breakdown.' },
    { key: 'canEditFollowUp', label: 'Log follow-ups', hint: 'Notes, next dates and cash forecasts.' },
    { key: 'canManagePdc', label: 'Manage cheques', hint: 'Add, present and clear post-dated cheques.' },
    { key: 'canReassignCrm', label: 'Reassign CRM owners', hint: 'Move accounts between team members.' },
    { key: 'canExportData', label: 'Export reports', hint: 'Download the cheque register. The book and reports also need Admin or Manager.' },
    { key: 'canDeleteCustomer', label: 'Delete customers', hint: 'Remove customer records for good.', danger: true },
];


const KNOWN_CRMS = ['ANKUR', 'PRIKSHIT', 'VISHNU', 'POONAM', 'SANDEEP', 'KAPIL', 'SAVIA', 'ROHINI', 'GARRY'];

const UserModal = ({ userToEdit, onSave, onClose, existingCrms = KNOWN_CRMS }: UserModalProps) => {
    const [name, setName] = useState('');
    const [crmCode, setCrmCode] = useState('');
    const [crmCodeTouched, setCrmCodeTouched] = useState(false);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<UserRole>(UserRole.CRM);
    const [password, setPassword] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [dataVisibility, setDataVisibility] = useState<DataVisibility>(DataVisibility.AssignedOnly);
    const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]);
    const [assignedCrms, setAssignedCrms] = useState<string[]>([]);
    const [customCrmInput, setCustomCrmInput] = useState('');

    useEffect(() => {
        setError('');
        setSaving(false);
        if (userToEdit) {
            setName(userToEdit.name);
            setCrmCode(userToEdit.id);
            setCrmCodeTouched(true);
            setEmail(userToEdit.email || '');
            setRole(userToEdit.role);
            setPassword(''); // Don't pre-fill password
            setDataVisibility(userToEdit.dataVisibility || (userToEdit.role === UserRole.Admin ? DataVisibility.All : DataVisibility.AssignedOnly));
            setPermissions(userToEdit.permissions || DEFAULT_ROLE_PERMISSIONS[userToEdit.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]);
            setAssignedCrms(userToEdit.assignedCrms || (userToEdit.role === UserRole.CRM ? [userToEdit.id] : []));
        } else {
            setName('');
            setCrmCode('');
            setCrmCodeTouched(false);
            setEmail('');
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

    // What the field shows; normalised properly only when the form is sent.
    const shownCrmCode = crmCodeTouched ? crmCode : toCrmCode(name);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (saving) return;
        setError('');

        if (!name.trim()) {
            setError('Enter the teammate\'s full name.');
            return;
        }
        const finalCrmCode = toCrmCode(shownCrmCode);
        if (!finalCrmCode) {
            setError('Enter a CRM code — it is what links customer rows to this person.');
            return;
        }
        if (!userToEdit && !email.trim()) {
            setError('Enter an email address. That is what the teammate signs in with.');
            return;
        }
        if (!userToEdit && password.trim().length < 6) {
            setError('Set a password of at least 6 characters for the new account.');
            return;
        }
        if (password.trim() && password.trim().length < 6) {
            setError('The password must be at least 6 characters.');
            return;
        }

        const finalVisibility = role === UserRole.Admin ? DataVisibility.All : dataVisibility;

        setSaving(true);
        try {
            await onSave({
                id: userToEdit ? userToEdit.id : finalCrmCode,
                name: name.trim(),
                email: email.trim() ? email.trim().toLowerCase() : undefined,
                role,
                password: password.trim() ? password.trim() : undefined,
                dataVisibility: finalVisibility,
                permissions: {
                    ...permissions,
                    canViewAllCrms: finalVisibility === DataVisibility.All ? true : permissions.canViewAllCrms,
                },
                assignedCrms: assignedCrms.length > 0 ? assignedCrms : undefined,
            });
        } catch (err: any) {
            setError(err?.message || 'Could not save this user.');
        } finally {
            setSaving(false);
        }
    };

    // Combine standard and custom CRM names
    const allCrmChoices = Array.from(new Set([...existingCrms, ...assignedCrms]));

    return (
        <DialogShell
            title={userToEdit ? `Edit ${userToEdit.name}` : 'Add a team member'}
            subtitle="Who they are, what they see, and what they may change."
            size="md"
            onClose={onClose}
            closeOnEscape={!saving}
            onSubmit={handleSubmit}
            footerNote={error && <span role="alert" className="font-semibold text-dang">{error}</span>}
            footer={<>
                <Button type="button" variant="quiet" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : userToEdit ? 'Save changes' : 'Create login'}</Button>
            </>}
        >
                <div className="space-y-5">
                    {/* Who they are */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label htmlFor="userName" className={LABEL}>
                                Full name <span className="text-dang ml-0.5" aria-hidden="true">*</span>
                            </label>
                            <input
                                id="userName"
                                type="text"
                                value={name}
                                data-autofocus
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Ankur Sharma"
                                className={FIELD}
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="userEmail" className={LABEL}>
                                Sign-in email <span className="text-dang ml-0.5" aria-hidden="true">*</span>
                            </label>
                            <input
                                id="userEmail"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="e.g. ankur@yourcompany.com"
                                autoComplete="off"
                                className={FIELD}
                                required={!userToEdit}
                            />
                        </div>
                        <div>
                            <label htmlFor="userCrmCode" className={LABEL}>
                                CRM code {userToEdit && <span className="normal-case tracking-normal font-medium text-label-3">(fixed)</span>}
                            </label>
                            <input
                                id="userCrmCode"
                                type="text"
                                value={shownCrmCode}
                                onChange={(e) => { setCrmCodeTouched(true); setCrmCode(typeCrmCode(e.target.value)); }}
                                placeholder="e.g. ANKUR"
                                readOnly={!!userToEdit}
                                className={cx(FIELD, 'font-mono font-bold tracking-wide', userToEdit && 'opacity-70')}
                            />
                            <p className="mt-1 text-[12px] text-label-3">
                                {userToEdit
                                    ? 'Customer rows are linked to this code, so it cannot be changed.'
                                    : 'Must match the CRM name in the accounts sheet for their portfolio to appear.'}
                            </p>
                        </div>
                        <div>
                            <label htmlFor="userPassword" className={LABEL}>
                                Password {userToEdit ? <span className="normal-case tracking-normal font-medium text-label-3">(leave blank to keep)</span> : <span className="text-dang ml-0.5" aria-hidden="true">*</span>}
                            </label>
                            <input
                                id="userPassword"
                                type="text"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder={userToEdit ? 'Keep the existing password' : 'At least 6 characters'}
                                autoComplete="new-password"
                                className={FIELD}
                            />
                        </div>
                    </div>

                    {/* Role: a preset of scope and rights, adjustable below */}
                    <div>
                        <label htmlFor="userRole" className={LABEL}>Role</label>
                        <select
                            id="userRole"
                            value={role}
                            onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                            className={cx(FIELD, 'font-semibold')}
                        >
                            {ROLE_CHOICES.map(r => <option key={r.role} value={r.role}>{r.label}</option>)}
                        </select>
                        <p className="mt-1 text-[12px] text-label-3">{ROLE_CHOICES.find(r => r.role === role)?.hint}</p>
                    </div>

                    {/* Scope: whose accounts they see */}
                    {role !== UserRole.Admin && (
                        <div>
                            <p className={LABEL}>Sees</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label="Whose accounts they see">
                                {SCOPE_CHOICES.map(c => {
                                    const on = dataVisibility === c.value;
                                    return (
                                        <label key={c.value} className={cx('flex items-start gap-3 rounded-[12px] border p-3 cursor-pointer transition-colors', on ? 'bg-accent-tint border-accent-tint-2' : 'bg-card-2 border-separator hover:bg-hover')}>
                                            <input
                                                type="radio"
                                                name="visibility"
                                                value={c.value}
                                                checked={on}
                                                onChange={() => setDataVisibility(c.value)}
                                                className="w-4 h-4 mt-0.5 accent-[var(--accent)]"
                                            />
                                            <span>
                                                <span className="block text-[13.5px] font-semibold text-label">{c.label}</span>
                                                <span className="block text-[12px] text-label-3 mt-0.5">{c.hint}</span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>

                            {dataVisibility === DataVisibility.AssignedOnly && (
                                <div className="mt-3 rounded-[12px] bg-card-2 p-3">
                                    <p className="text-[12px] font-semibold text-label-2 mb-2">Which CRM portfolios · press to include or leave out</p>
                                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Assigned CRM portfolios">
                                        {allCrmChoices.map(crm => {
                                            const isSelected = assignedCrms.includes(crm.toUpperCase());
                                            return (
                                                <button
                                                    key={crm}
                                                    type="button"
                                                    onClick={() => handleToggleCrm(crm)}
                                                    aria-pressed={isSelected}
                                                    className={cx('h-8 px-3 rounded-full text-[12.5px] font-bold font-mono transition-colors', isSelected ? 'bg-accent text-on-accent shadow-e1' : 'bg-card text-label-2 border border-separator hover:bg-hover')}
                                                >
                                                    {crm}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="flex items-center gap-2 mt-2.5">
                                        <input
                                            type="text"
                                            value={customCrmInput}
                                            onChange={e => setCustomCrmInput(e.target.value)}
                                            placeholder="Another CRM code, e.g. VIP_TEAM"
                                            aria-label="Another CRM code"
                                            className={cx(FIELD, 'h-9 max-md:h-10 bg-card')}
                                        />
                                        <Button type="button" size="sm" variant="secondary" onClick={handleAddCustomCrm}>Add</Button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Rights: the preset, adjusted per person */}
                    <div>
                        <div className="flex items-baseline justify-between gap-3 mb-1">
                            <p className={LABEL}>May</p>
                            <span className="text-[12px] text-label-3">The role fills these in; change any of them for this person.</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {RIGHT_CHOICES.map(r => {
                                const on = !!permissions[r.key];
                                return (
                                    <label key={r.key} className={cx('flex items-start gap-3 rounded-[12px] border p-3 cursor-pointer transition-colors', on ? (r.danger ? 'bg-dang-bg border-dang/30' : 'bg-accent-tint border-accent-tint-2') : 'bg-card-2 border-separator hover:bg-hover')}>
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => handlePermissionToggle(r.key)}
                                            className={cx('w-4 h-4 mt-0.5 rounded', r.danger ? 'accent-[var(--dang)]' : 'accent-[var(--accent)]')}
                                        />
                                        <span>
                                            <span className={cx('block text-[13.5px] font-semibold', on && r.danger ? 'text-dang' : 'text-label')}>{r.label}</span>
                                            <span className="block text-[12px] text-label-3 mt-0.5">{r.hint}</span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </div>
        </DialogShell>
    );
};

export default UserModal;
