import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { cx, Spinner } from './ui/Primitives';
import shoriLockup from '../assets/shori-lockup.png';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';
import { changeOwnPassword, signIn } from '../services/repository';

/* ============================================================================
   Sign in.

   Four screens behind one component, because they are one continuous journey:

     email  ->  password  ->  (in)                 the everyday path
     email  ->  reset link sent                    forgotten password
     recovery link  ->  choose a new password      returning from that email

   The staff roster is deliberately never listed here. Accounts live in
   Supabase and reading the list requires being signed in, so printing every
   colleague's name, role and CRM code on a page anyone with the URL can open
   would hand a stranger the org chart.
   ============================================================================ */

type Step = 'email' | 'password' | 'sent' | 'recovery' | 'recovered';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

const REMEMBERED_EMAIL = 'timely_last_email';

/* --------------------------------- glyphs -------------------------------- */

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

const MailGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3.5 7 8.5 6 8.5-6" />
  </svg>
);

const TickGlyph = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="m8.2 12.3 2.6 2.6 5-5.2" />
  </svg>
);

/* ------------------------------ error copy ------------------------------- */

/**
 * Supabase speaks in API terms. People need to know what to do next, and a
 * wrong password must never be distinguishable from an unknown address — that
 * difference is how an attacker enumerates who works here.
 */
function readableAuthError(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'That email and password do not match. Check both, or use "Forgot password".';
  }
  if (m.includes('email not confirmed')) {
    return 'This account still needs its email confirmed. Check your inbox for the confirmation link.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (m.includes('no profile exists')) {
    return 'Signed in, but this account has no profile yet. Ask an Admin to finish setting it up.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return message || 'Something went wrong. Try again.';
}

/* --------------------------------- screen -------------------------------- */

const LoginScreen = ({ onLogin }: LoginScreenProps) => {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem(REMEMBERED_EMAIL) || '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const passRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const newPassRef = useRef<HTMLInputElement>(null);

  /* --- arriving from a password-reset email ------------------------------ */
  useEffect(() => {
    if (!supabase) return;

    // Supabase puts the outcome in the URL fragment. An expired link comes back
    // as an error there, and used to leave people staring at a normal sign-in
    // form wondering why nothing happened.
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashError = hash.get('error_description') || hash.get('error');
    if (hashError) {
      setError(
        /expired|invalid/i.test(hashError)
          ? 'That reset link has expired. Ask for a new one below.'
          : decodeURIComponent(hashError.replace(/\+/g, ' '))
      );
      window.history.replaceState(null, '', window.location.pathname);
    }

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setStep('recovery');
        setError('');
        window.history.replaceState(null, '', window.location.pathname);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (step === 'password') passRef.current?.focus();
    if (step === 'email') emailRef.current?.focus();
    if (step === 'recovery') newPassRef.current?.focus();
  }, [step]);

  const trackCaps = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    setCapsOn(e.getModifierState?.('CapsLock') ?? false);
  }, []);

  /* --- steps ------------------------------------------------------------- */

  const goToPassword = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setError('Enter your work email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('That does not look like an email address.');
      return;
    }
    setError('');
    setEmail(value);
    setStep('password');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!password) {
      setError('Enter your password.');
      return;
    }

    setBusy(true);
    try {
      const user = await signIn(email, password);
      try {
        localStorage.setItem(REMEMBERED_EMAIL, email.trim().toLowerCase());
      } catch {
        /* private window — it just will not be remembered */
      }
      onLogin(user);
    } catch (err: any) {
      setError(readableAuthError(err?.message));
      setPassword('');
      passRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async () => {
    if (busy) return;
    setError('');
    const value = email.trim();
    if (!value) {
      setError('Enter your email address first.');
      setStep('email');
      return;
    }

    setBusy(true);
    try {
      const { error: err } = await supabase!.auth.resetPasswordForEmail(value, {
        redirectTo: window.location.origin,
      });
      if (err) throw err;
      setStep('sent');
    } catch (err: any) {
      setError(readableAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (newPassword.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }

    setBusy(true);
    try {
      await changeOwnPassword(newPassword);
      setNewPassword('');
      setStep('recovered');
    } catch (err: any) {
      setError(readableAuthError(err?.message));
    } finally {
      setBusy(false);
    }
  };

  /* --- chrome ------------------------------------------------------------ */

  const field =
    'w-full h-14 px-4 rounded-[14px] bg-card border-2 text-[15.5px] text-label ' +
    'placeholder:text-label-3 outline-none transition-colors';
  const fieldTone = (bad: boolean) =>
    bad ? 'border-dang' : 'border-separator-strong focus:border-accent';
  const primaryButton =
    'w-full h-12 mt-6 rounded-full bg-accent text-on-accent text-[15px] font-bold shadow-e1 ' +
    'hover:bg-accent-press active:scale-[.99] transition-all disabled:opacity-60 ' +
    'disabled:cursor-not-allowed inline-flex items-center justify-center gap-2';

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-bg grid place-items-center px-4">
        <div className="w-full max-w-[440px] bg-card rounded-[28px] shadow-e2 border-t-[5px] border-brand-yellow px-8 py-9 text-center">
          <img src={shoriLockup} alt="Shori Chemicals" className="h-11 w-auto object-contain mx-auto" />
          <h1 className="text-[22px] font-extrabold text-label tracking-[-0.03em] mt-6">Not configured</h1>
          <p className="text-[14.5px] text-label-2 mt-2 leading-relaxed">
            This deployment has no database behind it. Set <code className="font-mono text-[13px]">VITE_SUPABASE_URL</code> and{' '}
            <code className="font-mono text-[13px]">VITE_SUPABASE_ANON_KEY</code>, then redeploy.
          </p>
        </div>
      </div>
    );
  }

  const errorNote = error ? (
    <p role="alert" className="mt-2.5 text-[13.5px] font-medium text-dang">
      {error}
    </p>
  ) : null;

  return (
    <div className="min-h-screen bg-bg lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* ---------------------------------------------------------------
          Brand side. Desktop only: on a phone the keyboard is what matters,
          so the form comes first and this is dropped entirely.
          --------------------------------------------------------------- */}
      {/* The brand panel is the company's navy in both themes — an accent token
          would flip to pale blue in the dark and wash the whole thing out. */}
      <aside
        className="hidden lg:flex flex-col justify-between p-12 xl:p-16 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(158deg, #1B4478 0%, #12294A 62%, #0D1E38 100%)' }}
      >
        <div className="absolute inset-x-0 top-0 h-1.5 bg-brand-yellow" aria-hidden="true" />
        <div
          className="absolute -right-24 -bottom-24 w-[420px] h-[420px] rounded-full opacity-[0.09]"
          style={{ background: 'radial-gradient(circle, var(--brand-yellow) 0%, transparent 70%)' }}
          aria-hidden="true"
        />

        <img src={shoriLockup} alt="Shori Chemicals" className="h-12 w-auto object-contain self-start brightness-0 invert opacity-95" />

        <div className="relative max-w-[440px]">
          <h1 className="text-[40px] xl:text-[46px] font-extrabold tracking-[-0.04em] leading-[1.05]">
            The collections book,
            <br />
            in one place.
          </h1>
          <p className="text-[16px] leading-relaxed mt-5 opacity-80">
            Every outstanding account, every promise made, every cheque in hand —
            shared by the whole team and saved the moment you record it.
          </p>

          <div className="flex items-center gap-6 mt-10">
            {[
              { label: '1–45', v: 'var(--age-1)' },
              { label: '46–90', v: 'var(--age-2)' },
              { label: '91–135', v: 'var(--age-3)' },
              { label: '>135', v: 'var(--age-4)' },
            ].map(b => (
              <span key={b.label} className="inline-flex items-center gap-2 text-[12.5px] font-semibold opacity-75">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: b.v }} aria-hidden="true" />
                {b.label}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-[12.5px] opacity-60">
          Shori Chemicals Pvt. Ltd. · Ludhiana
        </p>
      </aside>

      {/* ------------------------------- form ------------------------------- */}
      <main className="flex flex-col items-center justify-center px-4 sm:px-8 py-12 min-h-screen lg:min-h-0">
        <div className="w-full max-w-[420px]">
          <img
            src={shoriLockup}
            alt="Shori Chemicals"
            className="h-10 w-auto object-contain mx-auto mb-8 lg:hidden"
          />
        <div className="bg-card rounded-[24px] shadow-e2 overflow-hidden border-t-[5px] border-brand-yellow lg:border-t-0 lg:shadow-e1">
          {/* ---------------------------- email ---------------------------- */}
          {step === 'email' && (
            <div className="px-8 pt-9 pb-9 flex flex-col items-center text-center">
              <h1 className="text-[27px] font-extrabold text-label tracking-[-0.03em]">Sign in</h1>
              <p className="text-[14.5px] text-label-2 mt-1.5">
                Use your work email to open the collections book
              </p>

              <form onSubmit={goToPassword} className="w-full mt-7 text-left" noValidate>
                <label htmlFor="email" className="sr-only">Work email</label>
                <input
                  id="email"
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  autoComplete="username"
                  autoFocus
                  placeholder="you@company.com"
                  aria-invalid={Boolean(error)}
                  className={cx(field, fieldTone(Boolean(error)))}
                />
                {errorNote}
                <button type="submit" className={primaryButton}>Continue</button>
              </form>
            </div>
          )}

          {/* --------------------------- password --------------------------- */}
          {step === 'password' && (
            <div className="px-8 py-9">
              <button
                onClick={() => { setStep('email'); setPassword(''); setError(''); }}
                className="flex items-center gap-2.5 h-11 pl-1.5 pr-4 -ml-1.5 rounded-full hover:bg-hover transition-colors"
              >
                <span className="w-8 h-8 rounded-full bg-accent-tint text-accent grid place-items-center text-[11.5px] font-bold flex-none">
                  @
                </span>
                <span className="text-[14px] font-semibold text-label truncate max-w-[240px]">{email}</span>
                <Chevron className="w-4 h-4 text-label-3 rotate-90" />
              </button>

              <h2 className="text-[24px] font-extrabold text-label tracking-[-0.03em] mt-7">Welcome back</h2>
              <p className="text-[14px] text-label-2 mt-1.5">Enter your password to continue.</p>

              <form onSubmit={submit} className="mt-7" noValidate>
                <label htmlFor="pw" className="sr-only">Password</label>
                <div className="relative">
                  <input
                    id="pw"
                    ref={passRef}
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); setError(''); }}
                    onKeyUp={trackCaps}
                    onKeyDown={trackCaps}
                    autoComplete="current-password"
                    placeholder="Password"
                    aria-invalid={Boolean(error)}
                    className={cx(field, 'pr-14', fieldTone(Boolean(error)))}
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

                {capsOn && !error && (
                  <p className="mt-2.5 text-[13px] font-medium text-warn">Caps Lock is on.</p>
                )}
                {errorNote}

                <button type="submit" disabled={busy} className={primaryButton}>
                  {busy && <Spinner className="w-4 h-4" />}
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
              </form>
            </div>
          )}

          {/* --------------------------- link sent -------------------------- */}
          {step === 'sent' && (
            <div className="px-8 py-10 text-center">
              <span className="w-14 h-14 rounded-full bg-accent-tint text-accent grid place-items-center mx-auto">
                <MailGlyph />
              </span>
              <h2 className="text-[22px] font-extrabold text-label tracking-[-0.03em] mt-6">Check your inbox</h2>
              <p className="text-[14.5px] text-label-2 mt-2.5 leading-relaxed">
                If an account exists for <span className="font-semibold text-label">{email}</span>, a link to
                choose a new password is on its way. It expires in an hour.
              </p>
              <button
                onClick={() => { setStep('password'); setError(''); }}
                className="mt-7 h-11 px-5 rounded-full text-[14px] font-semibold text-accent hover:bg-accent-tint transition-colors"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* -------------------------- new password ------------------------ */}
          {step === 'recovery' && (
            <div className="px-8 py-9">
              <h2 className="text-[24px] font-extrabold text-label tracking-[-0.03em]">Choose a new password</h2>
              <p className="text-[14px] text-label-2 mt-1.5">
                You followed a reset link, so you can set a new password now.
              </p>

              <form onSubmit={saveNewPassword} className="mt-7" noValidate>
                <label htmlFor="newpw" className="sr-only">New password</label>
                <div className="relative">
                  <input
                    id="newpw"
                    ref={newPassRef}
                    type={showPass ? 'text' : 'password'}
                    value={newPassword}
                    onChange={e => { setNewPassword(e.target.value); setError(''); }}
                    onKeyUp={trackCaps}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    aria-invalid={Boolean(error)}
                    className={cx(field, 'pr-14', fieldTone(Boolean(error)))}
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
                {capsOn && !error && (
                  <p className="mt-2.5 text-[13px] font-medium text-warn">Caps Lock is on.</p>
                )}
                {errorNote}
                <button type="submit" disabled={busy} className={primaryButton}>
                  {busy && <Spinner className="w-4 h-4" />}
                  {busy ? 'Saving…' : 'Save password'}
                </button>
              </form>
            </div>
          )}

          {/* --------------------------- recovered -------------------------- */}
          {step === 'recovered' && (
            <div className="px-8 py-10 text-center">
              <span className="w-14 h-14 rounded-full bg-pos-bg text-pos grid place-items-center mx-auto">
                <TickGlyph />
              </span>
              <h2 className="text-[22px] font-extrabold text-label tracking-[-0.03em] mt-6">Password changed</h2>
              <p className="text-[14.5px] text-label-2 mt-2.5 leading-relaxed">
                Use it the next time you sign in. You are already signed in on this device.
              </p>
              <button
                onClick={() => window.location.reload()}
                className={cx(primaryButton, 'mt-7')}
              >
                Open the collections book
              </button>
            </div>
          )}
        </div>

        {(step === 'email' || step === 'password') && (
          <div className="flex items-center justify-center mt-5 px-2">
            <button
              onClick={sendReset}
              disabled={busy}
              className="h-9 px-3.5 rounded-full text-[13.5px] font-semibold text-accent hover:bg-accent-tint transition-colors disabled:opacity-50"
            >
              Forgot password
            </button>
          </div>
        )}

          <p className="text-center text-[12.5px] text-label-3 mt-8 lg:hidden">
            Timely Payment · Shori Chemicals Pvt. Ltd.
          </p>
        </div>
      </main>
    </div>
  );
};

export default LoginScreen;
