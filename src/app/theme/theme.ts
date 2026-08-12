import { createTheme, type ThemeOptions } from '@mui/material/styles';

/**
 * Нейтральный серо-синий бренд из мокапов (registration.html / profile.html) — одна точка
 * брендинга. Токены совпадают с `.light`/`.dark` в docs/mockups.
 */
const shared: ThemeOptions = {
  shape: { borderRadius: 8 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
  components: {
    // Ссылки подчёркиваются только при наведении — во всех экранах.
    MuiLink: { defaultProps: { underline: 'hover' } },
    MuiOutlinedInput: {
      styleOverrides: {
        // Автозаполнение браузера кладёт в поле собственную заливку поверх фона: она красит весь
        // бокс ввода, включая полосу под вырезом рамки, и подпись поля оказывается на чужом фоне.
        // Красим её в фон карточки, чтобы подставленное значение выглядело как набранное руками.
        input: ({ theme }) => ({
          '&:-webkit-autofill': {
            WebkitBoxShadow: `0 0 0 100px ${theme.palette.background.paper} inset`,
            WebkitTextFillColor: theme.palette.text.primary,
            caretColor: theme.palette.text.primary,
          },
        }),
      },
    },
  },
};

export const lightTheme = createTheme({
  ...shared,
  palette: {
    mode: 'light',
    primary: { main: '#3b6ea5', contrastText: '#ffffff' },
    background: { default: '#f4f5f7', paper: '#ffffff' },
    text: { primary: '#1a1d21', secondary: '#6b7280' },
    divider: '#e2e5ea',
  },
});

export const darkTheme = createTheme({
  ...shared,
  palette: {
    mode: 'dark',
    primary: { main: '#5b8fc7', contrastText: '#0c0e10' },
    background: { default: '#121417', paper: '#1b1e23' },
    text: { primary: '#e7e9ec', secondary: '#9aa3af' },
    divider: '#2a2e35',
  },
});
