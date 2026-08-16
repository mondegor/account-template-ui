import type { ReactNode } from 'react';
import { Alert, Button, CircularProgress, Typography } from '@mui/material';

/** Презентационные атомы вывода/действий над MUI (плоские пропсы). */

export function UiText({ children }: { children?: ReactNode }) {
  return (
    <Typography
      variant="body2"
      data-testid="ui-text"
      sx={{
        color: 'text.secondary',
      }}
    >
      {children}
    </Typography>
  );
}

export function UiAlert({
  severity = 'error',
  children,
}: {
  severity?: 'error' | 'warning' | 'info' | 'success';
  children?: ReactNode;
}) {
  return (
    // Плашка отбивается с обеих сторон одинаково: своего верхнего отступа у неё не было вовсе, и
    // она прижималась к строке над собой. Боковые поля уже дефолтных — карточка узкая, и текст
    // в плашке должен переноситься не раньше соседних строк.
    <Alert severity={severity} sx={{ my: 1, px: 1.5 }} data-testid="ui-alert">
      {children}
    </Alert>
  );
}

/**
 * Рост знака занятости по росту кнопки: MUI меряет знак в кнопке кеглем и сам его не подстраивает.
 */
const BUSY_SIZE = { small: 18, medium: 18, large: 20 };

/**
 * Знак занятости кнопки — одно определение на приложение. Спиннер встаёт на место знака кнопки, и
 * разойдись он с ним в росте, подпись дёргалась бы на каждой отправке.
 *
 * Цвет берётся от кнопки: занятая кнопка погашена, и свой тон спиннера спорил бы с её серым.
 */
export function UiBusyIcon({ size = 'medium' }: { size?: keyof typeof BUSY_SIZE }) {
  return <CircularProgress size={BUSY_SIZE[size]} color="inherit" />;
}

export function UiButton({
  label,
  type = 'button',
  onClick,
  disabled,
  busy,
  fullWidth = true,
  variant = 'contained',
  color = 'primary',
}: {
  label: string;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  /**
   * За кнопкой ушёл запрос. Одного гашения мало: серая кнопка у формы уже значит «отправлять
   * нечего», и человек не отличает по ней идущий запрос от неготовой формы.
   */
  busy?: boolean;
  fullWidth?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      // Занятая кнопка гасится сама: нажимать её нечего, а два согласованных пропса на каждом
      // вызове рано или поздно разойдутся.
      disabled={disabled || busy}
      // Гашение диктор не объявляет — без этого занятость доступна только глазу.
      aria-busy={busy || undefined}
      startIcon={busy ? <UiBusyIcon /> : undefined}
      fullWidth={fullWidth}
      variant={variant}
      color={color}
      // Минимальный отступ, чтобы показанное над кнопкой сообщение не упиралось в неё. Сколько
      // места нужно от кнопки до предыдущего блока, знает раскладка — она его и добирает.
      sx={{ mt: 0.5 }}
      data-testid="ui-button"
    >
      {label}
    </Button>
  );
}
