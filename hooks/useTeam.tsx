import { useState } from 'react';
import * as repo from '../services/repository';
import { User, UserRole, TeamMemberDraft } from '../types';
import type { Question } from './useDataSource';

interface TeamInputs {
    users: User[];
    setUsers: (users: User[]) => void;
    currentUser: User | null;
    setCurrentUser: (user: User) => void;
    notify: (type: 'success' | 'error', text: string) => void;
    ask: (q: Question) => void;
}

/**
 * Team & access: the user dialog (a person to edit, or none for a new
 * login), creating or updating a teammate's real Supabase login, and
 * removing one after the question is answered in the app.
 */
export function useTeam({ users, setUsers, currentUser, setCurrentUser, notify, ask }: TeamInputs) {
    const [userDialog, setUserDialog] = useState<{ user: User | null } | null>(null);

    const handleOpenUserModal = (user: User | null) => {
        setUserDialog({ user });
    };

    const handleCloseUserModal = () => {
        setUserDialog(null);
    };

    /**
     * Creates or updates a teammate's real Supabase login and profile, then
     * re-reads the roster so the table shows what the server actually holds.
     * Errors are rethrown for UserModal to display: the modal stays open, and a
     * failed save is never mistaken for a saved one.
     */
    const handleSaveUser = async (draft: TeamMemberDraft) => {
        const isNewUser = !userDialog?.user;
        const legacyId = (draft.id || draft.name).trim();

        const input: repo.TeamMemberInput = {
            id: legacyId,
            name: draft.name,
            email: draft.email,
            password: draft.password,
            role: draft.role,
            dataVisibility: draft.dataVisibility,
            permissions: draft.permissions,
            assignedCrms:
                draft.assignedCrms || (draft.role === UserRole.CRM ? [legacyId] : []),
        };

        if (isNewUser) {
            await repo.createTeamMember(input);
        } else {
            await repo.updateTeamMember(input);
        }

        const roster = await repo.fetchUsers();
        setUsers(roster);
        // Keep our own rights fresh if an Admin just edited their own row.
        const me = roster.find(u => u.id === currentUser?.id);
        if (me) setCurrentUser(me);

        notify(
            'success',
            isNewUser
                ? `${input.name} can now sign in with ${input.email}.`
                : `${input.name}'s role and rights are saved.`
        );
        handleCloseUserModal();
    };

    const handleDeleteUser = (userId: string) => {
        const who = users.find(u => u.id === userId);
        ask({
            title: 'Remove this team member?',
            confirmLabel: 'Remove access',
            body: <>
                <p><strong className="text-label">{who?.name || userId}</strong>{who ? ` · ${who.role}` : ''}{who?.email ? ` · ${who.email}` : ''}.</p>
                <p className="mt-2">Their login stops working immediately. The accounts they own stay in the book under their name until someone reassigns them.</p>
            </>,
            run: async () => {
                try {
                    await repo.deleteTeamMember(userId);
                    setUsers(await repo.fetchUsers());
                    notify('success', `${who?.name || userId} no longer has access.`);
                } catch (e: any) {
                    notify('error', e?.message || 'Could not remove the user.');
                }
            },
        });
    };

    return { userDialog, handleOpenUserModal, handleCloseUserModal, handleSaveUser, handleDeleteUser };
}
