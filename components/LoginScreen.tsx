import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { cx } from './ui/Primitives';
import shoriLockup from '../assets/shori-lockup.png';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { signIn } from '../services/repository';

/* ============================================================================
   Sign in — Google's account chooser, in an Apple card.

   Still two steps: say who you are, then prove it. What changed is that the
   roster is no longer listed here. Accounts now live in Supabase, and reading
   the staff list requires being signed in — so printing everyone's name, role
   and CRM assignment on a public login page would widen what a stranger with
   the URL can see. You type your email instead; everything else about this
   screen is unchanged.
   ============================================================================ */

interface LoginScreenProps {
  users?: User[];
  onLogin: (user: User) => void;
  onResetPassword?: (userId: string, newPassword: string) => void;
  onResetAll?: () => void;
}

const Chevron = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

const Eye = ({ off }: { off?: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {off ? (
      <>
        <path d="M10.6 6.2A9.7 9.7 0 0 1 12 6c5 0 9 4.5 9 6 0 .7-.9 2.2-2.4 3.5M6.3 8.1C4.2 9.5 3 11.3 3 12c0 1.5 4 6 9 6 1.2 0 2.3-.25 3.3-.66" />
        <path d="m3.5 3.5 17 17" />
      </>
    ) : (
      <>
        <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6z" />
        <circle cx="12" cy="12" r="2.6" />
      </>
    )}
  </svg>
);

const LoginScreen = ({ onLogin, onResetAll }: LoginScreenProps) => {
  const [email, setEmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);   // moved past the email step
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetError, setResetError] = useState('');
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (confirmed) passRef.current?.focus();
  }, [confirmed]);

  const goToPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setError('');
    setConfirmed(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');

    if (!isSupabaseConfigured) {
      setError('No backend is configured for this build.');
      return;
    }

    setBusy(true);
    try {
      onLogin(await signIn(email, password));
    } catch (err: any) {
      setError(err?.message || 'That password is not right. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError('');

    if (!supabase) {
      setResetError('No backend is configured for this build.');
      return;
    }
    if (!resetEmail.trim()) {
      setResetError('Enter the email address of the account.');
      return;
    }

    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      setNotice(`If an account exists for ${resetEmail.trim()}, a reset link is on its way.`);
      setResetOpen(false);
      setResetEmail('');
    } catch (err: any) {
      setResetError(err?.message || 'Could not send the reset email.');
    }
  };

  const field =
    'w-full h-14 px-4 rounded-[14px] bg-card border-2 text-[15.5px] text-label ' +
    'placeholder:text-label-3 outline-none transition-colors';

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="bg-card rounded-[28px] shadow-e2 overflow-hidden border-t-[5px] border-brand-yellow">
          {!confirmed ? (
            <div className="px-8 pt-9 pb-9 flex flex-col items-center text-center">
              <img src={shoriLockup} alt="Shori Chemicals" className="h-11 w-auto object-contain" />
              <h1 className="text-[26px] font-extrabold text-label tracking-[-0.03em] mt-6">Sign in</h1>
              <p className="text-[14.5px] text-label-2 mt-1.5">
                Use your work email to open the collections book
              </p>

              {notice && (
                <p className="w-full mt-5 text-[13.5px] font-medium text-pos bg-pos-bg rounded-[12px] px-4 py-3 text-left">
                  {notice}
                </p>
              )}

              <form onSubmit={goToPassword} className="w-full mt-7 text-left">
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  autoComplete="username"
                  autoFocus
                  placeholder="you@company.com"
                  className={cx(field, error ? 'border-dang' : 'border-separator-strong focus:border-accent')}
                />

                {error && <p className="mt-2.5 text-[13.5px] font-medium text-dang">{error}</p>}

                <button
                  type="submit"
                  className="w-full h-12 mt-6 rounded-full bg-accent text-on-accent text-[15px] font-bold shadow-e1 hover:bg-accent-press active:scale-[.99] transition-all"
                >
                  Continue
                </button>
              </form>
            </div>
          ) : (
            <div className="px-8 py-9">
              <button
                onClick={() => { setConfirmed(false); setPassword(''); setError(''); }}
                className="flex items-center gap-2.5 h-11 pl-1.5 pr-4 -ml-1.5 rounded-full hover:bg-hover transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-accent-tint text-accent grid place-items-center text-[11.5px] font-bold flex-none">
                  @
                </span>
                <span className="text-[14px] font-semibold text-label truncate max-w-[240px]">{email}</span>
                <Chevron className="w-4 h-4 text-label-3 rotate-90" />
              </button>

              <h2 className="text-[24px] font-extrabold text-label tracking-[-0.03em] mt-7">
                Welcome back
              </h2>
              <p className="text-[14px] text-label-2 mt-1.5">Enter your password to continue.</p>

              <form onSubmit={submit} className="mt-7">
                <div className="relative">
                  <input
                    id="pw"
                    ref={passRef}
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    autoComplete="current-password"
                    placeholder="Password"
                    className={cx(
                      'w-full h-14 pl-4 pr-14 rounded-[14px] bg-card border-2 text-[15.5px] text-label',
                      'placeholder:text-label-3 outline-none transition-colors',
                      error ? 'border-dang' : 'border-separator-strong focus:border-accent'
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(s => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 w-9 h-9 grid place-items-center rounded-full text-label-3 hover:text-label hover:bg-hover transition-colors"
                  >
                    <Eye off={showPass} />
                  </button>
                </div>

                {error && <p className="mt-2.5 text-[13.5px] font-medium text-dang">{error}</p>}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full h-12 mt-6 rounded-full bg-accent text-on-accent text-[15px] font-bold shadow-e1 hover:bg-accent-press active:scale-[.99] transition-all disabled:opacity-60"
                >
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-5 px-2">
          <button
            onClick={() => { setResetOpen(true); setResetError(''); setResetEmail(email); }}
            className="h-9 px-3.5 rounded-full text-[13.5px] font-semibold text-accent hover:bg-accent-tint transition-colors"
          >
            Forgot password
          </button>
          {onResetAll && (
            <button
              onClick={onResetAll}
              className="h-9 px-3.5 rounded-full text-[13.5px] font-medium text-label-3 hover:text-label hover:bg-hover transition-colors"
            >
              Restore default accounts
            </button>
          )}
        </div>

        <p className="text-center text-[12.5px] text-label-3 mt-7">
          Shori Chemicals Pvt. Ltd. &middot; Receivables &amp; collections
        </p>
      </div>

      {/* ---- reset dialog ---- */}
      {resetOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" onClick={() => setResetOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-h"
            className="relative w-full max-w-[420px] bg-card rounded-[24px] shadow-e3 p-7"
          >
            <h2 id="reset-h" className="text-[20px] font-extrabold text-label tracking-[-0.02em]">
              Reset your password
            </h2>
            <p className="text-[13.5px] text-label-2 mt-1.5">
              We&rsquo;ll email you a link to choose a new one.
            </p>

            <form onSubmit={doReset} className="mt-6 flex flex-col gap-4">
              <div>
                <label htmlFor="re" className="block text-[13px] font-semibold text-label-2 mb-2">
                  Email address
                </label>
                <input
                  id="re"
                  type="email"
                  value={resetEmail}
                  autoComplete="username"
                  onChange={e => { setResetEmail(e.target.value); setResetError(''); }}
                  className="w-full h-12 px-4 rounded-[12px] bg-card border-2 border-separator-strong focus:border-accent text-[14.5px] text-label outline-none transition-colors"
                />
              </div>

              {resetError && <p className="text-[13.5px] font-medium text-dang">{resetError}</p>}

              <div className="flex justify-end gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="h-11 px-5 rounded-full text-[14px] font-semibold text-label-2 hover:bg-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="h-11 px-6 rounded-full bg-accent text-on-accent text-[14px] font-bold shadow-e1 hover:bg-accent-press active:scale-[.98] transition-all"
                >
                  Send link
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default LoginScreen;
