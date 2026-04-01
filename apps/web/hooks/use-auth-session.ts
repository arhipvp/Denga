'use client';

import { useState } from 'react';
import type { AuthState } from '../lib/types';

const AUTH_STORAGE_KEY = 'denga-auth';

export function useAuthSession() {
  const [auth, setAuth] = useState<AuthState | null>(() => {
    if (typeof window === 'undefined') {
      return null;
    }

    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as AuthState;
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
  });

  const saveAuth = (nextAuth: AuthState) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    setAuth(nextAuth);
  };

  const clearAuth = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth(null);
  };

  return {
    auth,
    saveAuth,
    clearAuth,
    setAuth,
  };
}
