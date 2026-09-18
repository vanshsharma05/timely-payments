import { useState, useEffect, useRef } from 'react';
import * as repo from '../services/repository';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { User, UserRole, DEFAULT_ROLE_PERMISSIONS } from '../types';

interface SessionInputs {
    /** Everything read at sign-in, for the collections App keeps (the roster is kept here). */
    onLoaded: (all: Awaited<ReturnType<typeof repo.loadAll>>) => void;
    onLoadError: (message: string) => void;
    onSignedOut: () => void;
}

/**
 * Who is signed in, and the one read of every collection after sign-in.
 *
 * Supabase is the master record: state is hydrated from it on sign-in and
 * every change is written back, so the whole team shares one dataset.
 * Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY the app does not run
 * at all — LoginScreen says so rather than pretending to work. Signing out
 * (or a fresh start) drops `serverLoaded`, so the next sign-in re-reads
 * everything and the sync hooks re-seed without writing anything back.
 */
export function useSession({ onLoaded, onLoadError, onSignedOut }: SessionInputs) {
    const [users, setUsers] = useState<User[]>([]);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    /** The collections have been read from the server since sign-in; nothing syncs before that. */
    const [serverLoaded, setServerLoaded] = useState(false);
    const [restoringSession, setRestoringSession] = useState(isSupabaseConfigured);
    /** The book is on its way from the server. */
    const [loading, setLoading] = useState<boolean>(false);

    const callbacks = useRef({ onLoaded, onLoadError });
    callbacks.current = { onLoaded, onLoadError };

    // Restore an existing session on load so a refresh does not bounce you out.
    useEffect(() => {
        if (!isSupabaseConfigured) return;
        let cancelled = false;
        (async () => {
            try {
                const profile = await repo.fetchCurrentProfile();
                if (!cancelled && profile) {
                    setCurrentUser(profile);
                    setIsAuthenticated(true);
                }
            } catch {
                /* not signed in */
            } finally {
                if (!cancelled) setRestoringSession(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Hydrate every collection once, straight after sign-in.
    useEffect(() => {
        if (!isSupabaseConfigured || !isAuthenticated || serverLoaded) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const all = await repo.loadAll();
                if (cancelled) return;
                if (all.users.length) setUsers(all.users);
                callbacks.current.onLoaded(all);
                setServerLoaded(true);
            } catch (e: any) {
                if (!cancelled) callbacks.current.onLoadError(`Could not load data: ${e?.message || e}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isAuthenticated, serverLoaded]);

    const syncEnabled = isSupabaseConfigured && isAuthenticated && serverLoaded;

    const handleLogin = (user: User) => {
        const fullUser: User = {
            ...user,
            permissions: {
                ...(DEFAULT_ROLE_PERMISSIONS[user.role] || DEFAULT_ROLE_PERMISSIONS[UserRole.CRM]),
                ...(user.permissions || {})
            },
            assignedCrms: user.assignedCrms || (user.role === UserRole.CRM ? [user.id] : undefined)
        };
        setCurrentUser(fullUser);
        setIsAuthenticated(true);
    };

    const handleLogout = async () => {
        try { await repo.signOut(); } catch { /* local sign-out is enough */ }
        setServerLoaded(false);
        setIsAuthenticated(false);
        setCurrentUser(null);
        onSignedOut();
    };

    return {
        users, setUsers, currentUser, setCurrentUser, isAuthenticated, serverLoaded, restoringSession, loading, syncEnabled,
        /** After a fresh start: everything is re-read from the server. */
        reload: () => setServerLoaded(false),
        handleLogin, handleLogout,
    };
}
