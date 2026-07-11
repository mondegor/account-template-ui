import { afterEach, describe, expect, it } from 'vitest';
import { resolveThemeMode, useThemeMode } from './themeMode';

afterEach(() => useThemeMode.setState({ mode: 'system' }));

describe('resolveThemeMode', () => {
  it('system → следует за системным предпочтением', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
  });

  it('явный режим игнорирует систему', () => {
    expect(resolveThemeMode('light', true)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
  });
});

describe('useThemeMode', () => {
  it('cycleMode: system → light → dark → system', () => {
    useThemeMode.setState({ mode: 'system' });
    useThemeMode.getState().cycleMode();
    expect(useThemeMode.getState().mode).toBe('light');
    useThemeMode.getState().cycleMode();
    expect(useThemeMode.getState().mode).toBe('dark');
    useThemeMode.getState().cycleMode();
    expect(useThemeMode.getState().mode).toBe('system');
  });

  it('выбор режима персистится в localStorage', () => {
    useThemeMode.getState().setMode('dark');
    expect(localStorage.getItem('ui.themeMode')).toContain('dark');
  });
});
