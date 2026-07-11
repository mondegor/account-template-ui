import type { ReactNode } from 'react';
import { Box, Card, CardContent } from '@mui/material';
import { AuthLayout } from './AuthLayout';
import { BrandLockup } from './BrandLockup';

/**
 * Обёртка публичных auth-экранов: центрированная карточка (Вариант A) + бренд. Внутрь рендерится
 * схема (SchemaRenderer), навигационный футер (ссылки — вне схемы) передаётся отдельным пропом.
 */
export function AuthCard({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <AuthLayout>
      <Card variant="outlined" sx={{ width: 340 }}>
        <CardContent sx={{ px: 4, pt: 3, pb: 3, '&:last-child': { pb: 3 } }}>
          <BrandLockup />
          <Box sx={{ mt: 2 }}>{children}</Box>
          {footer}
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
