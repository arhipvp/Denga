'use client';

import { useSyncExternalStore } from 'react';
import type { AuthState } from '../lib/types';

const AUTH_STORAGE_KEY = 'denga-auth';
const AUTH_CHANGE_EVENT = 'denga-auth-change';

function readAuthFromStorage(): AuthState | null {
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
    return null;
  }
}

function subscribe(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleStorage = (event: Event) => {
    if (event instanceof StorageEvent && event.key && event.key !== AUTH_STORAGE_KEY) {
      return;
    }

    onStoreChange();
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(AUTH_CHANGE_EVENT, handleStorage);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(AUTH_CHANGE_EVENT, handleStorage);
  };
}

function emitAuthChange() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function useAuthSession() {
  const auth = useSyncExternalStore(subscribe, readAuthFromStorage, () => null);

  const saveAuth = (nextAuth: AuthState) => {
    window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth));
    emitAuthChange();
  };

  const clearAuth = () => {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    emitAuthChange();
  };

  return {
    auth,
    saveAuth,
    clearAuth,
  };
}
