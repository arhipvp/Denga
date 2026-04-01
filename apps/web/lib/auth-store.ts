import type { AuthState } from './types';

const AUTH_STORAGE_KEY = 'denga-auth';
const AUTH_CHANGE_EVENT = 'denga-auth-change';

type Listener = () => void;

type AuthStoreOptions = {
  storageKey?: string;
  changeEventName?: string;
  getWindow?: () => Window | undefined;
};

function readAuth(raw: string | null): AuthState | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AuthState;
  } catch {
    return null;
  }
}

export function createAuthStore({
  storageKey = AUTH_STORAGE_KEY,
  changeEventName = AUTH_CHANGE_EVENT,
  getWindow = () => (typeof window === 'undefined' ? undefined : window),
}: AuthStoreOptions = {}) {
  const listeners = new Set<Listener>();
  let cachedRaw: string | null | undefined;
  let cachedAuth: AuthState | null = null;
  let unsubscribeFromWindow: (() => void) | null = null;

  const notifyListeners = () => {
    listeners.forEach((listener) => listener());
  };

  const refreshSnapshot = () => {
    const currentWindow = getWindow();
    if (!currentWindow) {
      cachedRaw = null;
      cachedAuth = null;
      return cachedAuth;
    }

    const nextRaw = currentWindow.localStorage.getItem(storageKey);
    if (cachedRaw === nextRaw && cachedRaw !== undefined) {
      return cachedAuth;
    }

    cachedRaw = nextRaw;
    cachedAuth = readAuth(nextRaw);
    return cachedAuth;
  };

  const handleStorageChange = (event: Event) => {
    if (event instanceof StorageEvent && event.key && event.key !== storageKey) {
      return;
    }

    const previousRaw = cachedRaw;
    const previousAuth = cachedAuth;
    const nextAuth = refreshSnapshot();
    if (previousRaw !== cachedRaw || previousAuth !== nextAuth) {
      notifyListeners();
    }
  };

  const ensureWindowSubscription = () => {
    if (unsubscribeFromWindow) {
      return;
    }

    const currentWindow = getWindow();
    if (!currentWindow) {
      return;
    }

    currentWindow.addEventListener('storage', handleStorageChange);
    currentWindow.addEventListener(changeEventName, handleStorageChange);
    unsubscribeFromWindow = () => {
      currentWindow.removeEventListener('storage', handleStorageChange);
      currentWindow.removeEventListener(changeEventName, handleStorageChange);
    };
  };

  const updateSnapshot = (nextAuth: AuthState | null) => {
    cachedAuth = nextAuth;
    cachedRaw = nextAuth ? JSON.stringify(nextAuth) : null;
  };

  return {
    getSnapshot() {
      return refreshSnapshot();
    },
    getServerSnapshot() {
      return null;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      ensureWindowSubscription();

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && unsubscribeFromWindow) {
          unsubscribeFromWindow();
          unsubscribeFromWindow = null;
        }
      };
    },
    saveAuth(nextAuth: AuthState) {
      const currentWindow = getWindow();
      if (currentWindow) {
        currentWindow.localStorage.setItem(storageKey, JSON.stringify(nextAuth));
      }

      updateSnapshot(nextAuth);
      notifyListeners();
      currentWindow?.dispatchEvent(new Event(changeEventName));
    },
    clearAuth() {
      const currentWindow = getWindow();
      currentWindow?.localStorage.removeItem(storageKey);

      updateSnapshot(null);
      notifyListeners();
      currentWindow?.dispatchEvent(new Event(changeEventName));
    },
  };
}

export const authStore = createAuthStore();
