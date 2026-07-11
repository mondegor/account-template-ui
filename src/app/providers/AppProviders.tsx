import { useMemo, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { I18nextProvider } from 'react-i18next';
import { i18next } from '@core/i18n';
import { resolveThemeMode, useThemeMode } from '@core/shell';
import { darkTheme, lightTheme } from '../theme/theme';
import { queryClient } from '../modules';

export function AppProviders({ children }: { children: ReactNode }) {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const mode = useThemeMode((s) => s.mode);
  const theme = useMemo(
    () => (resolveThemeMode(mode, prefersDark) === 'dark' ? darkTheme : lightTheme),
    [mode, prefersDark],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18next}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <BrowserRouter>{children}</BrowserRouter>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
