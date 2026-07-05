import type { ReactNode } from 'react';
import { Box } from '@mui/material';

/** Публичная зона auth: центрированная карточка (Вариант A из мокапов) на фоне. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 3,
      }}
    >
      {children}
    </Box>
  );
}
