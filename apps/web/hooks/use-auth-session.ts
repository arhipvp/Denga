'use client';

import { useSyncExternalStore } from 'react';
import { authStore } from '../lib/auth-store';

export function useAuthSession() {
  const auth = useSyncExternalStore(
    authStore.subscribe,
    authStore.getSnapshot,
    authStore.getServerSnapshot,
  );

  return {
    auth,
    saveAuth: authStore.saveAuth,
    clearAuth: authStore.clearAuth,
  };
}
