import type { ReactNode } from 'react';
import { Alert, Button, Typography } from '@mui/material';

/** Презентационные атомы вывода/действий над MUI (плоские пропсы). */

export function UiText({ children }: { children?: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" data-testid="ui-text">
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
    <Alert severity={severity} sx={{ mb: 2 }} data-testid="ui-alert">
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
      sx={{ mt: 1 }}
      data-testid="ui-button"
    >
      {label}
    </Button>
  );
}
