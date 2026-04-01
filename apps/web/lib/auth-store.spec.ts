import { createAuthStore } from './auth-store';
import type { AuthState } from './types';

class FakeStorageEvent extends Event {
  key: string | null;

  constructor(type: string, key: string | null) {
    super(type);
    this.key = key;
  }
}

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }

  removeItem(key: string) {
    this.store.delete(key);
  }
}

function createFakeWindow() {
  const target = new EventTarget();
  const localStorage = new MemoryStorage();

  return {
    localStorage,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  } as unknown as Window;
}

describe('auth store', () => {
  const auth: AuthState = {
    accessToken: 'token',
    user: {
      email: 'admin@example.com',
      role: 'ADMIN',
    },
  };

  beforeAll(() => {
    Object.defineProperty(globalThis, 'StorageEvent', {
      configurable: true,
      writable: true,
      value: FakeStorageEvent,
    });
  });

  it('returns a stable snapshot while storage is unchanged', () => {
    const fakeWindow = createFakeWindow();
    fakeWindow.localStorage.setItem('denga-auth', JSON.stringify(auth));
    const store = createAuthStore({ getWindow: () => fakeWindow });

    const first = store.getSnapshot();
    const second = store.getSnapshot();

    expect(first).toEqual(auth);
    expect(second).toBe(first);
  });

  it('updates auth once and notifies subscribers once on save', () => {
    const fakeWindow = createFakeWindow();
    const store = createAuthStore({ getWindow: () => fakeWindow });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.saveAuth(auth);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(auth);
    expect(store.getSnapshot()).toBe(auth);
    expect(fakeWindow.localStorage.getItem('denga-auth')).toBe(JSON.stringify(auth));

    unsubscribe();
  });

  it('clears auth and notifies subscribers once', () => {
    const fakeWindow = createFakeWindow();
    fakeWindow.localStorage.setItem('denga-auth', JSON.stringify(auth));
    const store = createAuthStore({ getWindow: () => fakeWindow });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.getSnapshot();
    store.clearAuth();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBeNull();
    expect(fakeWindow.localStorage.getItem('denga-auth')).toBeNull();

    unsubscribe();
  });

  it('syncs from storage events without reparsing unchanged auth', () => {
    const fakeWindow = createFakeWindow();
    fakeWindow.localStorage.setItem('denga-auth', JSON.stringify(auth));
    const store = createAuthStore({ getWindow: () => fakeWindow });
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);
    const first = store.getSnapshot();

    const nextAuth: AuthState = {
      accessToken: 'next-token',
      user: {
        email: 'admin@example.com',
        role: 'ADMIN',
      },
    };

    fakeWindow.localStorage.setItem('denga-auth', JSON.stringify(nextAuth));
    fakeWindow.dispatchEvent(new FakeStorageEvent('storage', 'denga-auth'));

    const second = store.getSnapshot();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(second).toEqual(nextAuth);
    expect(second).not.toBe(first);
    expect(store.getSnapshot()).toBe(second);

    unsubscribe();
  });
});
