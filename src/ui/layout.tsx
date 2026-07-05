import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * Презентационные атомы раскладки над MUI (плоские пропсы, без знания о схеме). Schema-aware
 * адаптеры живут в core/renderer и мапят узлы на эти атомы (направление зависимостей core → ui).
 */

export function UiPage({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <Box data-testid="ui-page">
      {title && (
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      )}
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Box>
  );
}

export function UiSection({ spacing = 2, children }: { spacing?: number; children?: ReactNode }) {
  return (
    <Stack spacing={spacing} data-testid="ui-section">
      {children}
    </Stack>
  );
}

/** Адаптивная сетка через CSS grid (не зависим от версии MUI Grid). cols — число или брейкпоинт-мапа. */
export function UiGrid({
  cols = 1,
  spacing = 2,
  children,
}: {
  cols?: number | Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>;
  spacing?: number;
  children?: ReactNode;
}) {
  const templ =
    typeof cols === 'number'
      ? `repeat(${cols}, 1fr)`
      : Object.fromEntries(
          Object.entries(cols).map(([bp, n]) => [bp, `repeat(${n}, 1fr)`]),
        );
  return (
    <Box
      data-testid="ui-grid"
      sx={{ display: 'grid', gap: spacing, gridTemplateColumns: templ }}
    >
      {children}
    </Box>
  );
}
