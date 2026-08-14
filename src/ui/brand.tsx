import { Box, Stack, Typography } from '@mui/material';

/**
 * Нейтральный line-знак шаблона — изометрический куб. Ничего не обозначает предметно: форк меняет
 * контуры на свой логотип. Тот же глиф лежит в `public/favicon.svg` — правим в обоих местах.
 */
function BrandMark({ size }: { size: number }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: size, height: size, color: 'primary.main', display: 'block', flexShrink: 0 }}
    >
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
    </Box>
  );
}

/**
 * Брендовый локап: знак + «ACCOUNT·TEMPLATE» приглушённым eyebrow. Общий для auth-экранов и
 * топ-бара кабинета. Имя бренда остаётся литералом — оно одинаково во всех языках интерфейса.
 */
export function UiBrandLockup({ size = 22 }: { size?: number }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: 'center',
      }}
    >
      <BrandMark size={size} />
      <Typography
        variant="overline"
        sx={{ fontWeight: 700, letterSpacing: '.12em', color: 'text.secondary', lineHeight: 1 }}
      >
        ACCOUNT·TEMPLATE
      </Typography>
    </Stack>
  );
}
