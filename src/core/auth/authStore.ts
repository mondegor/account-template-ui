import { create } from 'zustand';

/**
 * Auth-состояние. access-токен — ТОЛЬКО в памяти (не персистится); трактуется как opaque
 * Bearer независимо от access_type (session|jwt). expiresAt — абсолютный момент истечения
 * для проактивного refresh (backend_answers §3).
 */

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthState {
  status: AuthStatus;
  accessToken: string | null;
  /** epoch ms, когда access истекает (из expires_in ответа). */
  expiresAt: number | null;
  setAccess: (token: string, expiresInSec: number | undefined) => void;
  clear: () => void;
  setAnonymous: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  accessToken: null,
  expiresAt: null,
  setAccess: (token, expiresInSec) =>
    set({
      status: 'authenticated',
      accessToken: token,
      expiresAt: expiresInSec ? Date.now() + expiresInSec * 1000 : null,
    }),
  clear: () => set({ status: 'anonymous', accessToken: null, expiresAt: null }),
  setAnonymous: () => set({ status: 'anonymous', accessToken: null, expiresAt: null }),
}));

/** Не-реактивный доступ для интерсепторов axios. */
export const authStore = {
  getAccess: () => useAuthStore.getState().accessToken,
  getExpiresAt: () => useAuthStore.getState().expiresAt,
  setAccess: (t: string, e: number | undefined) => useAuthStore.getState().setAccess(t, e),
  clear: () => useAuthStore.getState().clear(),
  setAnonymous: () => useAuthStore.getState().setAnonymous(),
};
