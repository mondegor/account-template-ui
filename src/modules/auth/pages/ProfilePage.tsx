import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
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
import { forceLogout } from '@core/auth';
import { moduleQueryKey } from '@core/module-registry';
import { getUserInfo } from '../api/authApi';
import type { UserAuth2fa, UserInfo, UserStatus } from '../api/types';

const TWO_FA_LABEL: Record<UserAuth2fa, string> = {
  NONE: '2FA: выкл.',
  PASSWORD: '2FA: пароль',
  TOTP: '2FA: TOTP',
};

const STATUS_COLOR: Record<UserStatus, 'default' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'default',
  ENABLED: 'success',
  DISABLED: 'warning',
  BLOCKED: 'error',
};

function fmt(dt: string | undefined): string {
  if (!dt) return '—';
  const d = new Date(dt);
  return Number.isNaN(d.getTime()) ? dt : d.toLocaleString('ru-RU');
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  );
}

function ProfileView({ user }: { user: UserInfo }) {
  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          Профиль
        </Typography>
        {/* TODO: настоящий выход должен вызывать DELETE /v1/session (серверная инвалидация +
            сброс cookie RTID); сейчас forceLogout — только клиентская очистка. См. refresh.ts. */}
        <Button size="small" variant="outlined" onClick={() => forceLogout()}>
          Выйти
        </Button>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Учётная запись
          </Typography>
          <Divider />
          <Row label="Email" value={user.email} />
          <Row label="Телефон" value={user.phone ?? '—'} />
          <Row label="Язык" value={user.lang} />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Безопасность
          </Typography>
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={TWO_FA_LABEL[user.auth_2fa_type]} />
            <Chip size="small" color={STATUS_COLOR[user.status]} label={user.status} />
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Активность
          </Typography>
          <Divider />
          <Row label="Последний вход" value={fmt(user.last_logged_at)} />
          <Row label="IP последнего входа" value={user.last_login_ip} />
          <Row label="Создан" value={fmt(user.created_at)} />
          <Row label="Обновлён" value={fmt(user.updated_at)} />
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>
            Realms
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Realm</TableCell>
                <TableCell>Тип</TableCell>
                <TableCell>Создан</TableCell>
                <TableCell>Обновлён</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {user.realms.map((r) => (
                <TableRow key={r.name}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell>{r.user_kind}</TableCell>
                  <TableCell>{fmt(r.created_at)}</TableCell>
                  <TableCell>{fmt(r.updated_at)}</TableCell>
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
  const { data, isLoading, isError, error } = useQuery({
    queryKey: moduleQueryKey('auth', 'user'),
    queryFn: getUserInfo,
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', p: 3 }}>
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Alert severity="error" sx={{ maxWidth: 880, mx: 'auto' }}>
          Не удалось загрузить профиль: {(error as Error).message}
        </Alert>
      )}
      {data && <ProfileView user={data} />}
    </Box>
  );
}
