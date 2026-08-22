'use client';

import { useCallback, useEffect, useState } from 'react';

const KEY = 'nightline.surveyKey';

/**
 * Surveyor session, kept on the device.
 *
 * Surveying happens on a phone while walking campus at night. Asking someone to
 * sign in on a dark path is how a survey does not get done, so the passcode is
 * entered once and remembered here.
 */
export function useSurveyor() {
  const [key, setKeyState] = useState<string | null>(null);
  const [authorised, setAuthorised] = useState(false);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);

  const verify = useCallback(async (candidate: string | null) => {
    try {
      const res = await fetch('/api/survey', {
        headers: candidate ? { 'x-survey-key': candidate } : {},
      });
      const d = await res.json();
      setAvailable(Boolean(d.enabled));
      setAuthorised(Boolean(d.authorised));
      return Boolean(d.authorised);
    } catch {
      setAvailable(false);
      setAuthorised(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    setKeyState(stored);
    void verify(stored);
  }, [verify]);

  const signIn = useCallback(
    async (candidate: string) => {
      const ok = await verify(candidate);
      if (ok) {
        setKeyState(candidate);
        try {
          localStorage.setItem(KEY, candidate);
        } catch {
          /* ignore */
        }
      }
      return ok;
    },
    [verify],
  );

  const signOut = useCallback(() => {
    setKeyState(null);
    setAuthorised(false);
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  /** Headers for a surveyor-only request. */
  const headers = useCallback(
    (): Record<string, string> => (key ? { 'x-survey-key': key } : {}),
    [key],
  );

  return { authorised, available, checking, signIn, signOut, headers };
}
