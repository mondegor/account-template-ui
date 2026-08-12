import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

/**
 * Строка футера публичных auth-экранов: подпись с переходом на соседний экран (`AuthNavLink`).
 * Оформление держим здесь, чтобы три экрана не разъезжались.
 *
 * `tight` — для строки, идущей сразу за такой же: полный отступ между ними читался бы как
 * отдельный блок, а это продолжение того же перечня выходов с экрана.
 */
export function AuthFooterLine({ tight, children }: { tight?: boolean; children: ReactNode }) {
  return (
    <Typography
      variant="body2"
      align="center"
      sx={{
        color: 'text.secondary',
        mt: tight ? 0.75 : 2.5,
      }}
    >
      {children}
    </Typography>
  );
}
