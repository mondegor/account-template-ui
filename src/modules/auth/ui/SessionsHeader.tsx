import { FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { realmLabel } from '../lib/realmLabel';
import type { UserRealm } from '../api/types';

/**
 * Строка заголовка. Реалм показываем, только если их больше одного: выбирать не из чего, а
 * «print-shop/standard» пользователю ничего не говорит — тогда просто «Сессии».
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
    <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('realmTitle')}
      </Typography>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel id="sessions-realm-label">{p('realm')}</InputLabel>
        {/* value — сырое имя реалма: уходит в query-ключ и в API; пользователь видит только label. */}
        <Select
          labelId="sessions-realm-label"
          label={p('realm')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
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
