import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Режим темы — ручной выбор поверх системного. `system` следует за prefers-color-scheme,
 * `light`/`dark` — жёсткая фиксация. Выбор персистится в localStorage (переживает reload).
 * Разрешение в конкретную палитру — в AppProviders через resolveThemeMode(); сам стор
 * доменно-агностичен и живёт в core (палитра — забота слоя app).
 */
export type ThemeMode = 'system' | 'light' | 'dark';

const CYCLE: readonly ThemeMode[] = ['system', 'light', 'dark'];

interface ThemeModeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Циклический переключатель для кнопки в топ-баре: system → light → dark → system. */
  cycleMode: () => void;
}

export const useThemeMode = create<ThemeModeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      setMode: (mode) => set({ mode }),
      cycleMode: () => set({ mode: CYCLE[(CYCLE.indexOf(get().mode) + 1) % CYCLE.length] }),
    }),
    { name: 'ui.themeMode' },
  ),
);

/** system → фактическая палитра по системному предпочтению; иначе — выбранная явно. */
export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return prefersDark ? 'dark' : 'light';
  return mode;
}
