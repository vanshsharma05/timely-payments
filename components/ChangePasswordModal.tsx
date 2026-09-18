import React, { useRef, useState } from 'react';
import { changeOwnPassword } from '../services/repository';
import { Button, Spinner, cx } from './ui/Primitives';
import { DialogShell } from './ui/DialogShell';
import { FIELD, LABEL } from './ui/fields';

/**
 * Change your own password.
 *
 * Every role gets this, including read-only Viewers: it acts on the signed-in
 * session, so it needs no admin rights and no service key. Admins changing
 * somebody *else's* password is a different thing, and lives in Team & access.
 */
const ChangePasswordModal = ({
    onClose,
    onDone,
}: {
    onClose: () => void;
    onDone: () => void;
}) => {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const firstRef = useRef<HTMLInputElement>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError('');

        if (password.length < 8) {
            setError('Use at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            setError('The two passwords do not match.');
            return;
        }

        setBusy(true);
        try {
            await changeOwnPassword(password);
            onDone();
        } catch (err: any) {
            setError(err?.message || 'Could not change the password.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <DialogShell
            title="Change password"
            subtitle="You will stay signed in on this device."
            size="sm"
            onClose={onClose}
            closeOnEscape={!busy}
            onSubmit={submit}
            footer={<>
                <Button type="button" variant="quiet" onClick={onClose} disabled={busy}>Cancel</Button>
                <Button type="submit" variant="primary" disabled={busy}>
                    {busy && <Spinner className="w-4 h-4" />}
                    {busy ? 'Saving…' : 'Change password'}
                </Button>
            </>}
        >
            <label htmlFor="newPassword" className={LABEL}>New password</label>
            <input
                id="newPassword"
                ref={firstRef}
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                autoComplete="new-password"
                data-autofocus
                placeholder="At least 8 characters"
                className={cx(FIELD, error && 'border-dang')}
            />

            <label htmlFor="confirmPassword" className={`${LABEL} mt-4`}>Repeat it</label>
            <input
                id="confirmPassword"
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={e => { setConfirm(e.target.value); setError(''); }}
                autoComplete="new-password"
                placeholder="Same again"
                className={cx(FIELD, error && 'border-dang')}
            />

            <label className="flex items-center gap-2 mt-3.5 text-[13.5px] text-label-2">
                <input
                    type="checkbox"
                    checked={show}
                    onChange={e => setShow(e.target.checked)}
                    className="w-4 h-4 rounded"
                />
                Show what I am typing
            </label>

            {error && (
                <p role="alert" className="mt-3.5 text-[13.5px] font-semibold text-dang">{error}</p>
            )}
        </DialogShell>
    );
};

export default ChangePasswordModal;
