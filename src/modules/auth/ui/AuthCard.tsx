import type { ReactNode } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { FORM_CARD_WIDTH, UiBrandLockup } from '@ui';
import { AuthLayout } from './AuthLayout';

/**
 * Обёртка публичных auth-экранов: центрированная карточка (Вариант A) + бренд. Внутрь рендерится
 * схема (SchemaRenderer), навигационный футер (ссылки — вне схемы) передаётся отдельным пропом.
 */
export function AuthCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <AuthLayout>
      <Card variant="outlined" sx={{ width: FORM_CARD_WIDTH }}>
        <CardContent sx={{ px: 3.5, pt: 3, pb: 3, '&:last-child': { pb: 3 } }}>
          <UiBrandLockup />
          <Box sx={{ mt: 1 }}>{children}</Box>
          {footer}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
