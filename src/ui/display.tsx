import type { ReactNode } from 'react';
import { Alert, Button, Typography } from '@mui/material';

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

export function UiButton({
  label,
  type = 'button',
  onClick,
  disabled,
  fullWidth = true,
  variant = 'contained',
  color = 'primary',
}: {
  label: string;
  type?: 'button' | 'submit';
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning';
}) {
  return (
    <Button
      type={type}
      onClick={onClick}
      disabled={disabled}
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
