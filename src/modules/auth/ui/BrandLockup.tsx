import { Box, Stack, Typography } from '@mui/material';

/** Небольшой line-логотип «принтер» (Feather-стиль), в тон брендовому акценту. */
function BrandMark() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 22, height: 22, color: 'primary.main', display: 'block', flexShrink: 0 }}
    >
      <path d="M6 9V3h12v6" />
      <path d="M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" />
      <rect x="6" y="14" width="12" height="7" rx="1" />
    </Box>
  );
}

/** Брендовый локап: лого + «PRINT·SHOP» приглушённым eyebrow. Общий для auth-экранов. */
export function BrandLockup() {
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <BrandMark />
      <Typography
        variant="overline"
        sx={{ fontWeight: 700, letterSpacing: '.12em', color: 'text.secondary', lineHeight: 1 }}
      >
        PRINT·SHOP
      </Typography>
    </Stack>
  );
}
