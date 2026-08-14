import type { ComponentType, ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * Примечание в подвале auth-карточки: оговорка к форме. Плашкой его не делаем — ничего не
 * случилось; форма сноски и есть её смысл.
 *
 * Знак и его цвет выбирает экран: они говорят про его текст, и одного значка на все оговорки не
 * бывает. Умолчания у цвета нет намеренно — тон это и есть громкость сноски, и решать её молча за
 * экран нечем. Здесь остаётся размер: по нему сноски разных экранов и совпадают друг с другом.
 *
 * Цвет задаётся путём в палитре, не литералом: сноска живёт в обеих темах, и «белый» на светлой
 * карточке пропадёт.
 */
export function AuthFooterNote({
  icon: Icon,
  tone,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  tone: string;
  children: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'flex-start',
        justifyContent: 'center',
        // Примечание идёт за кнопкой — прибавки строчного бокса сверху нет, поэтому число то же,
        // что у прочих зазоров карточки.
        mt: 2,
      }}
    >
      <Box sx={{ color: tone, display: 'flex', flexShrink: 0, mt: '2px' }}>
        <Icon size={17} />
      </Box>
      {/* На ступень мельче строки футера: это сноска, а не ещё один выход с экрана. */}
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
        {children}
      </Typography>
    </Stack>
  );
}
