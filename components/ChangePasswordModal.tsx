import React, { useRef, useState } from 'react';
import { changeOwnPassword } from '../services/repository';
import { Button, Spinner, cx } from './ui/Primitives';

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

    const field =
        'w-full h-12 px-4 rounded-[12px] bg-card-2 border-2 text-[15px] text-label ' +
        'placeholder:text-label-3 outline-none transition-colors';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex justify-center items-center p-4">
            <div className="bg-card rounded-[20px] shadow-e3 w-full max-w-[420px] p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-[19px] font-extrabold text-label tracking-[-0.02em]">Change password</h2>
                        <p className="text-[13.5px] text-label-3 mt-1">
                            You will stay signed in on this device.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close"
                        className="w-9 h-9 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover text-[20px] leading-none"
                    >
                        &times;
                    </button>
                </div>

                <form onSubmit={submit} className="mt-6" noValidate>
                    <label htmlFor="newPassword" className="label block mb-1.5">New password</label>
                    <input
                        id="newPassword"
                        ref={firstRef}
                        type={show ? 'text' : 'password'}
                        value={password}
                        onChange={e => { setPassword(e.target.value); setError(''); }}
                        autoComplete="new-password"
                        autoFocus
                        placeholder="At least 8 characters"
                        className={cx(field, error ? 'border-dang' : 'border-separator-strong focus:border-accent')}
                    />

                    <label htmlFor="confirmPassword" className="label block mt-4 mb-1.5">Repeat it</label>
                    <input
                        id="confirmPassword"
                        type={show ? 'text' : 'password'}
                        value={confirm}
                        onChange={e => { setConfirm(e.target.value); setError(''); }}
                        autoComplete="new-password"
                        placeholder="Same again"
                        className={cx(field, error ? 'border-dang' : 'border-separator-strong focus:border-accent')}
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

                    <div className="flex justify-end gap-2.5 mt-6">
                        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                        <Button type="submit" variant="primary" disabled={busy}>
                            {busy && <Spinner className="w-4 h-4" />}
                            {busy ? 'Saving…' : 'Change password'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ChangePasswordModal;
