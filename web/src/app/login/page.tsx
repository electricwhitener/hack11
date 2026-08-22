'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';
import { APP_NAME } from '@/components/layout/nav';

/**
 * Sign in.
 *
 * Google is the primary path: one click, and crucially it sends NO email, so
 * it cannot be throttled by Supabase's free-tier email rate limit (a handful
 * per hour). Email + password is the fallback for when the venue network
 * blocks the OAuth redirect — also no email, because confirmation is disabled.
 */
export default function LoginPage() {
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Re-enable the form whenever this page becomes visible again.
   *
   * Starting the Google redirect sets busy=true and deliberately leaves it set,
   * because the browser is navigating away. But if the user comes BACK — hits
   * cancel, an OAuth error, or the back button — busy was never cleared and
   * EVERY control stayed disabled, including the email form. That looked like
   * "email login is broken" when the form simply could not be submitted.
   *
   * `pageshow` covers the back-button/bfcache restore that a plain mount
   * effect misses.
   */
  useEffect(() => {
    const reenable = () => setBusy(false);
    reenable();
    window.addEventListener('pageshow', reenable);
    return () => window.removeEventListener('pageshow', reenable);
  }, []);

  // Surface the reason when /auth/callback bounced the user back here.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('error');
    if (reason) setError(reason);
  }, []);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // If the redirect has not happened within a few seconds something blocked
    // it (popup blocker, offline). Do not strand the user on a dead button.
    setTimeout(() => setBusy(false), 5000);
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        // No account yet? Create one. Saves a separate signup screen, which is
        // one less thing to click through in a demo.
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
        });

        if (signUpError) {
          /*
           * "Already registered" here has TWO causes and they need different
           * advice:
           *
           *  1. The account was created with Google. Supabase stores NO password
           *     for an OAuth signup, so there is nothing for the entered
           *     password to match — a Google account's password belongs to
           *     Google, not to us. This looks exactly like a wrong password and
           *     is the reported bug.
           *  2. The account really does have a password and it was mistyped.
           *
           * Supabase deliberately will not tell the client which, because that
           * would let anyone enumerate accounts. So name both, and lead with
           * the one that actually strands people.
           */
          setError(
            /already registered|already exists/i.test(signUpError.message)
              ? 'That email is already registered. If you first signed in with Google, use ' +
                '“Continue with Google” above — a Google account has no separate password here. ' +
                'Otherwise, check the password and try again.'
              : signUpError.message,
          );
          setBusy(false);
          return;
        }

        if (!signUpData.session) {
          // Only happens if email confirmation is still switched on in Supabase.
          setNotice('Account created. Check your email to confirm, then sign in.');
          setBusy(false);
          return;
        }
      }

      // Full page load, not router.push: the server needs to read the session
      // cookie that was just written, and a client-side transition can render
      // from a cached payload that still believes you are signed out.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Signing in is optional. It only saves your conversations.
        </p>

        <Button onClick={signInWithGoogle} disabled={busy} className="mt-8 w-full" size="lg">
          <GoogleMark />
          Continue with Google
        </Button>

        <div className="my-6 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={signInWithPassword} className="space-y-3">
          <Input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" variant="secondary" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Continue with email'}
          </Button>
        </form>

        {error && (
          <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-4 rounded-lg border bg-muted p-3 text-sm text-muted-foreground">
            {notice}
          </p>
        )}

        <p className="mt-6 text-center text-xs text-muted-foreground">
          New here? Entering an email and password creates your account.
        </p>

        {/* Nobody has to sign in to use this. Anyone who landed here from a
            shared link should be one click from the actual product. */}
        <p className="mt-4 text-center text-xs">
          <a href="/" className="text-primary underline-offset-4 hover:underline">
            Skip — take me to the map
          </a>
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z"
      />
    </svg>
  );
}
