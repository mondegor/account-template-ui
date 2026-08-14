import type { ReactNode } from 'react';
import { Typography } from '@mui/material';

/**
 * Строка футера публичных auth-экранов: подпись с переходом на соседний экран (`AuthNavLink`).
 * Оформление держим здесь, чтобы три экрана не разъезжались.
 *
 * Отступ сверху зависит от того, что стоит выше, потому что глаз меряет не поля, а просвет: у
 * текста сверх букв есть ещё несколько пикселей строчного бокса, и одно и то же число даёт разный
 * зазор под кнопкой и под абзацем.
 *  - `box` — под кнопкой или полем: прибавки сверху нет, отступ нужен полный;
 *  - `text` — под абзацем (примечание подвала): просвет добавляют обе строки, и число меньше;
 *  - `tight` — под такой же строкой: намеренно теснее, это продолжение того же перечня выходов с
 *    экрана, а не отдельный блок.
 */
const GAP = { box: 2, text: 1.5, tight: 0.75 } as const;

export function AuthFooterLine({
  above = 'box',
  children,
}: {
  above?: keyof typeof GAP;
  children: ReactNode;
}) {
  return (
    <Typography
      variant="body2"
      align="center"
      sx={{
        color: 'text.secondary',
        mt: GAP[above],
      }}
    >
      {children}
    </Typography>
  );
}
