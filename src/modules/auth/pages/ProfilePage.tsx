import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { AppShell, LangFlag } from '@core/shell';
import { formatRelativeTime, isEnglish } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { getUserInfo } from '../api/authApi';
import { fmt, fmtDate, useLocale, useNow } from '../lib/format';
import { realmLabel, userKindLabel } from '../lib/realmLabel';
import { Row } from '../ui/Row';
import type { UserInfo, UserStatus } from '../api/types';

const STATUS_COLOR: Record<UserStatus, 'default' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'default',
  ENABLED: 'success',
  DISABLED: 'warning',
  BLOCKED: 'error',
};

function ProfileView({ user }: { user: UserInfo }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const p = (key: string) => t(`auth.profile.${key}`);
  const now = useNow(60_000);
  const lastLogin = formatRelativeTime(user.last_logged_at, {
    locale,
    now,
    justNow: p('lastLoginJustNow'),
  });
  // Инвариант деплоя: у пользователя всегда есть минимум один реалм — случая «нуль кабинетов» не
  // бывает. Поэтому один кабинет — выбирать не из чего: показываем его данные строками в «Учётной
  // записи» (soleRealm заведомо определён, его created_at/user_kind — законный источник строк
  // «Зарегистрирован» и «Тип аккаунта») и слова «кабинет» не вводим вовсе. Несколько — отдельная
  // карточка со сравнительной таблицей.
  const multiRealm = user.realms.length > 1;
  const soleRealm = multiRealm ? undefined : user.realms[0];

  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('title')}
      </Typography>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
            {p('account')}
          </Typography>
          <Divider />
          {soleRealm && (
            <Row label={p('accountKind')} value={userKindLabel(t, soleRealm.user_kind)} />
          )}
          <Row label={p('email')} value={user.email} />
          <Row label={p('phone')} value={user.phone ?? '—'} />
          <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              {p('lang')}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <LangFlag lang={isEnglish(user.lang) ? 'en' : 'ru'} />
              <Typography variant="body2">{user.lang}</Typography>
            </Stack>
          </Stack>
          {soleRealm && (
            <Row label={p('registeredAt')} value={fmtDate(soleRealm.created_at, locale)} />
          )}
        </CardContent>
      </Card>

      {multiRealm && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>
              {p('realms')}
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{p('realmName')}</TableCell>
                  <TableCell>{p('accountKind')}</TableCell>
                  <TableCell>{p('registeredAt')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {user.realms.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell>{realmLabel(t, r.name)}</TableCell>
                    <TableCell>{userKindLabel(t, r.user_kind)}</TableCell>
                    <TableCell>{fmtDate(r.created_at, locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>
            {p('security')}
          </Typography>
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={p(`twoFa.${user.auth_2fa_type}`)} />
            <Chip size="small" color={STATUS_COLOR[user.status]} label={user.status} />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
            {p('activity')}
          </Typography>
          <Divider />
          {lastLogin ? (
            <Row label={p('lastLogin')} value={lastLogin.label} title={lastLogin.title} />
          ) : (
            <Row label={p('lastLogin')} value={fmt(user.last_logged_at, locale)} />
          )}
          <Row label={p('lastLoginIp')} value={user.last_login_ip} />
          <Row label={p('updatedAt')} value={fmt(user.updated_at, locale)} />
        </CardContent>
      </Card>
    </Stack>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: moduleQueryKey('auth', 'user'),
    queryFn: getUserInfo,
  });

  return (
    <AppShell>
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Alert severity="error" sx={{ maxWidth: 880, mx: 'auto' }}>
          {t('auth.profile.loadError', { message: (error as Error).message })}
        </Alert>
      )}
      {data && <ProfileView user={data} />}
    </AppShell>
  );
}
