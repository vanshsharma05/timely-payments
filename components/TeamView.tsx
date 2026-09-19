import { useState } from 'react';
import { User, UserRole, DataVisibility, UserPermissions, CompanyProfile } from '../types';
import { Badge, Button, Card, EmptyState, cx } from './ui/Primitives';
import { EditIcon, TrashIcon, UserPlusIcon } from './icons/Icons';
import { CompanyProfileView } from './CompanyProfileView';

interface TeamViewProps {
    users: User[];
    onAdd: () => void;
    onEdit: (user: User) => void;
    onRemove: (userId: string) => void;
    companyProfile: CompanyProfile;
    onSaveCompanyProfile: (profile: CompanyProfile) => void;
}

/** The rights a person holds, in the order the form lists them. */
const RIGHTS: { key: keyof UserPermissions; label: string }[] = [
    { key: 'canAddCustomer', label: 'Add customers' },
    { key: 'canEditCustomer', label: 'Edit details' },
    { key: 'canEditFinancials', label: 'Edit financials' },
    { key: 'canEditFollowUp', label: 'Follow-ups' },
    { key: 'canManagePdc', label: 'Cheques' },
    { key: 'canReassignCrm', label: 'Reassign CRM' },
    { key: 'canDeleteCustomer', label: 'Delete customers' },
    { key: 'canExportData', label: 'Export' },
];

const seesEverything = (u: User) => u.role === UserRole.Admin || u.dataVisibility === DataVisibility.All;
const scopeOf = (u: User) => (u.assignedCrms && u.assignedCrms.length > 0 ? u.assignedCrms : [u.id]);

/** The role, in the app's one badge. Admin is the only role that reads differently: it is the app's owner. */
const RoleBadge = ({ role }: { role: UserRole }) => (
    <Badge tone={role === UserRole.Admin ? 'brand' : 'neutral'}>{role}</Badge>
);

/** Whose accounts this person sees: everyone's, or the CRM codes they are assigned. */
const Scope = ({ user }: { user: User }) =>
    seesEverything(user) ? (
        <Badge tone="pos">All accounts</Badge>
    ) : (
        <span className="flex flex-wrap gap-1">
            {scopeOf(user).map(c => (
                <Badge key={c} tone="neutral" className="font-mono">{c}</Badge>
            ))}
        </span>
    );

/** What the person may change. Admin holds every right, so it is said once. */
const Rights = ({ user }: { user: User }) => {
    if (user.role === UserRole.Admin) return <Badge tone="brand">Everything</Badge>;
    const held = RIGHTS.filter(r => user.permissions?.[r.key]);
    if (held.length === 0) return <span className="text-[12.5px] text-label-3">Read only</span>;
    return (
        <span className="flex flex-wrap gap-1">
            {held.map(r => <Badge key={r.key} tone="neutral">{r.label}</Badge>)}
        </span>
    );
};

/**
 * Team & access: who can sign in, what they see, what they may change — and
 * the company's own details on the second tab.
 *
 * Styled the way the book and the register are: one card, the segmented
 * control the book uses for its halves, the register's table chrome, the
 * app's one badge for roles, scope and rights, and the delete control shown
 * on hover the way the book's is. On a phone each person is a card.
 */
export const TeamView = ({ users, onAdd, onEdit, onRemove, companyProfile, onSaveCompanyProfile }: TeamViewProps) => {
    const [tab, setTab] = useState<'team' | 'company'>('team');
    const TABS = [
        { key: 'team' as const, label: 'Team members', count: users.length },
        { key: 'company' as const, label: 'Company profile' },
    ];
    return (
        <Card className="overflow-hidden">
            <div className="px-5 py-4 max-md:px-4 border-b border-separator flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-card-2 p-1 gap-1 max-md:flex max-md:w-full" role="tablist" aria-label="Team members or company profile">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            type="button"
                            role="tab"
                            aria-selected={tab === t.key}
                            onClick={() => setTab(t.key)}
                            className={cx(
                                'h-8 px-3.5 rounded-lg text-[13px] font-bold transition-colors max-md:flex-1 max-md:h-11',
                                tab === t.key ? 'bg-accent text-on-accent shadow-e1' : 'text-label-2 hover:bg-hover hover:text-label'
                            )}
                        >
                            {t.label}
                            {t.count !== undefined && <span className="ml-1.5 font-semibold opacity-80 num">{t.count}</span>}
                        </button>
                    ))}
                </div>
                {tab === 'team' && (
                    <div className="flex items-center gap-2 max-md:[&>button]:flex-1 max-md:[&>button]:min-h-[44px]">
                        <Button size="sm" variant="primary" onClick={onAdd} icon={<UserPlusIcon className="w-4 h-4" />}>
                            Add a team member
                        </Button>
                    </div>
                )}
            </div>

            {tab === 'company' ? (
                <CompanyProfileView profile={companyProfile} onSave={onSaveCompanyProfile} />
            ) : users.length === 0 ? (
                <EmptyState
                    title="Nobody on the team yet"
                    hint="Add the people who chase payments. Each one signs in with their own address and sees only what their role allows."
                    action={<Button size="sm" variant="primary" onClick={onAdd}>Add a team member</Button>}
                />
            ) : (
                <>
                    {/* Phone: five columns will not fit, so each person is a card —
                        name, role, scope, rights, and the two actions. */}
                    <div className="md:hidden divide-y divide-separator">
                        {users.map(user => (
                            <div key={user.id} className="px-4 py-3.5">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-bold text-label text-[15px] truncate">{user.name}</p>
                                        <p className="text-[12px] text-label-3 mt-0.5 truncate">
                                            <span className="font-mono">{user.id}</span>
                                            {user.email ? ` · ${user.email}` : ''}
                                        </p>
                                    </div>
                                    <RoleBadge role={user.role} />
                                </div>
                                <div className="mt-2.5 space-y-1.5">
                                    <div className="flex items-start gap-2 text-[12px] text-label-3">
                                        <span className="w-10 flex-none pt-[3px]">Sees</span>
                                        <Scope user={user} />
                                    </div>
                                    <div className="flex items-start gap-2 text-[12px] text-label-3">
                                        <span className="w-10 flex-none pt-[3px]">May</span>
                                        <Rights user={user} />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 mt-3">
                                    <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => onEdit(user)} icon={<EditIcon className="w-3.5 h-3.5" />}>
                                        Edit rights
                                    </Button>
                                    {user.role !== UserRole.Admin && (
                                        <button
                                            type="button"
                                            onClick={() => onRemove(user.id)}
                                            className="w-11 h-11 grid place-items-center text-label-3 hover:text-dang hover:bg-dang-bg rounded-full transition-colors"
                                            aria-label={`Remove ${user.name}`}
                                            title="Remove their access"
                                        >
                                            <TrashIcon className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="overflow-x-auto max-md:hidden">
                        <table className="w-full text-left border-collapse text-xs">
                            <thead className="bg-card-2 text-[11.5px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-separator">
                                <tr>
                                    <th className="px-4 py-2.5">Person</th>
                                    <th className="px-3 py-2.5">Role</th>
                                    <th className="px-3 py-2.5">Sees</th>
                                    <th className="px-3 py-2.5">May</th>
                                    <th className="px-4 py-2.5 text-right"><span className="sr-only">Actions</span></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-separator">
                                {users.map(user => (
                                    <tr key={user.id} className="group hover:bg-hover transition-colors">
                                        <td className="px-4 py-3 whitespace-nowrap">
                                            <span className="block font-bold text-label text-[13.5px]">{user.name}</span>
                                            <span className="block text-[12px] text-label-3">
                                                <span className="font-mono">{user.id}</span>
                                                {user.email ? ` · ${user.email}` : ''}
                                            </span>
                                        </td>
                                        <td className="px-3 py-3 whitespace-nowrap"><RoleBadge role={user.role} /></td>
                                        <td className="px-3 py-3"><Scope user={user} /></td>
                                        <td className="px-3 py-3"><Rights user={user} /></td>
                                        <td className="px-4 py-3 whitespace-nowrap text-right">
                                            <div className="flex justify-end items-center gap-1">
                                                <Button size="sm" variant="quiet" onClick={() => onEdit(user)} icon={<EditIcon className="w-3.5 h-3.5" />} title="Change their role, scope or rights">
                                                    Edit rights
                                                </Button>
                                                {user.role !== UserRole.Admin ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => onRemove(user.id)}
                                                        className="w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center text-label-3 hover:text-dang hover:bg-dang-bg rounded-full transition-colors max-md:opacity-100 md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 group-focus-within:opacity-100"
                                                        aria-label={`Remove ${user.name}`}
                                                        title="Remove their access"
                                                    >
                                                        <TrashIcon className="w-4 h-4" />
                                                    </button>
                                                ) : (
                                                    <span className="w-8 h-8 flex-none" aria-hidden="true" />
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </Card>
    );
};

export default TeamView;
