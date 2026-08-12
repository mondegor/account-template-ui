import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { ShieldDotsIcon } from './icons';

/**
 * Примечание в подвале auth-карточки: условие, при котором экран вообще подходит. Плашкой его не
 * делаем — ничего не случилось, это оговорка, а не происшествие; форма сноски за навигационной
 * строкой и есть её смысл.
 *
 * Предупреждающий тон остаётся только на щите: пятно размером с глиф глаз находит, но с заголовком
 * и кнопкой не спорит. Щит тот же, что метит двухфакторную защиту в профиле, — о ней здесь и речь.
 */
export function AuthFooterNote({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'flex-start',
        justifyContent: 'center',
        mt: 2,
        pt: 1.75,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ color: 'warning.main', display: 'flex', flexShrink: 0, mt: '2px' }}>
        <ShieldDotsIcon size={17} />
      </Box>
      {/* На ступень мельче строки футера: примечание читают после неё, а не вместо неё. */}
      <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 12 }}>
        {children}
      </Typography>
    </Stack>
  );
}
