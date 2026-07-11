import { useEffect, useState } from 'react';
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
import { formatRelativeTime } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { getUserInfo } from '../api/authApi';
import type { UserInfo, UserStatus } from '../api/types';

const STATUS_COLOR: Record<UserStatus, 'default' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'default',
  ENABLED: 'success',
  DISABLED: 'warning',
  BLOCKED: 'error',
};

/** Дата в локали активного языка (en → en-US, иначе ru-RU); пустое/битое значение — как есть. */
function fmt(dt: string | undefined, locale: string): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleString(locale);
}

/** Только дата в локали активного языка; пустое/битое значение — как есть. */
function fmtDate(dt: string | undefined, locale: string): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleDateString(locale);
}

/** Тик раз в `intervalMs` — чтобы относительное время («N назад») само пересчитывалось. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
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

function ProfileView({ user }: { user: UserInfo }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.startsWith('en') ? 'en-US' : 'ru-RU';
  const p = (key: string) => t(`auth.profile.${key}`);
  const now = useNow(60_000);
  const lastLogin = formatRelativeTime(user.last_logged_at, {
    locale,
    now,
    justNow: p('lastLoginJustNow'),
  });
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
          <Row label={p('email')} value={user.email} />
          <Row label={p('phone')} value={user.phone ?? '—'} />
          <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
            <Typography variant="body2" color="text.secondary">
              {p('lang')}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={1}>
              <LangFlag lang={user.lang.startsWith('en') ? 'en' : 'ru'} />
              <Typography variant="body2">{user.lang}</Typography>
            </Stack>
          </Stack>
          <Row label={p('registeredAt')} value={fmtDate(user.created_at, locale)} />
        </CardContent>
      </Card>

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

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 700 }}>
            {p('realms')}
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{p('realmName')}</TableCell>
                <TableCell>{p('realmKind')}</TableCell>
                <TableCell>{p('createdAt')}</TableCell>
                <TableCell>{p('updatedAt')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {user.realms.map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.user_kind}</TableCell>
                  <TableCell>{fmt(r.created_at, locale)}</TableCell>
                  <TableCell>{fmt(r.updated_at, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
