import { Stack, Typography } from '@mui/material';

/** Строка «ключ слева — значение справа» в карточках профиля и сессий. */
export function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" title={title} sx={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}
