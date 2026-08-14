import { FormControl, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { realmLabel } from '../lib/realmLabel';
import type { UserRealm } from '../api/types';

/**
 * Строка заголовка. Реалм показываем, только если их больше одного: выбирать не из чего, а
 * «account-template/standard» пользователю ничего не говорит — тогда просто «Сессии».
 */
export function SessionsHeader({
  realms,
  value,
  onChange,
}: {
  realms: UserRealm[];
  value: string;
  onChange: (realm: string) => void;
}) {
  const { t } = useTranslation();
  const p = (key: string) => t(`auth.sessions.${key}`);

  if (realms.length < 2) {
    return (
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('title')}
      </Typography>
    );
  }

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('realmTitle')}
      </Typography>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        {/* Что выбирают, названо заголовком слева, поэтому имя селекта только в `aria-label`. */}
        {/* value — сырое имя реалма: уходит в query-ключ и в API; пользователь видит только label. */}
        <Select aria-label={p('realm')} value={value} onChange={(e) => onChange(e.target.value)}>
          {realms.map((r) => (
            <MenuItem key={r.name} value={r.name}>
              {realmLabel(t, r.name)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
}
