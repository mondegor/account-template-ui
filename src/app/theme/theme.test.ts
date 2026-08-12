import { describe, expect, it } from 'vitest';
import type { Theme } from '@mui/material/styles';
import { darkTheme, lightTheme } from './theme';

type AutofillStyle = { WebkitBoxShadow: string; WebkitTextFillColor: string; caretColor: string };

function autofillStyle(theme: Theme): AutofillStyle {
  const input = theme.components?.MuiOutlinedInput?.styleOverrides?.input;
  if (typeof input !== 'function') throw new Error('MuiOutlinedInput input override is missing');
  const style = input({ theme, ownerState: {} }) as Record<string, AutofillStyle>;
  return style['&:-webkit-autofill'];
}

describe('autofill', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('the %s theme fills an autofilled field with the paper background', (_mode, theme) => {
    const style = autofillStyle(theme);
    expect(style.WebkitBoxShadow).toContain(theme.palette.background.paper);
    expect(style.WebkitTextFillColor).toBe(theme.palette.text.primary);
    expect(style.caretColor).toBe(theme.palette.text.primary);
  });
});
