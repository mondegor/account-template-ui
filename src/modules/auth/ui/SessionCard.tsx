import {
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fmtLong, useLocale } from '../lib/format';
import { Row } from './Row';
import { TimeRow } from './TimeRow';
import {
  CalendarIcon,
  ClockIcon,
  HourglassIcon,
  MapPinIcon,
  NetworkIcon,
  TrashIcon,
} from './icons';
import type { UserSession } from '../api/types';

/**
 * Одна открытая сессия. `current` — акцентная рамка и чип вместо корзины: свою сессию закрывают
 * кнопкой «Выйти» в шапке, а не отсюда.
 */
export function SessionCard({
  session,
  variant,
  now,
  onClose,
  isClosing,
  disabled,
}: {
  session: UserSession;
  variant: 'current' | 'other';
  /** Общий тик списка: таймер один на страницу, а не по одному на карточку. */
  now: number;
  onClose?: () => void;
  /** Спиннер вместо корзины: закрывается именно эта сессия. */
  isClosing?: boolean;
  /** Идёт другое закрытие (массовое или соседней карточки) — кликать нельзя, но и спиннера нет. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const p = (key: string) => t(`auth.sessions.${key}`);
  const isCurrent = variant === 'current';

  return (
    <Card
      variant="outlined"
      sx={isCurrent ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}
    >
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
          <Stack sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
              {session.device_name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {session.app_name}
            </Typography>
          </Stack>
          {isCurrent ? (
            <Chip size="small" color="primary" label={p('current')} />
          ) : (
            <Tooltip title={p('closeOne')}>
              {/* span — чтобы Tooltip работал и на disabled-кнопке (во время закрытия). */}
              <span>
                <IconButton
                  size="small"
                  color="error"
                  aria-label={`${p('closeOne')}: ${session.device_name}`}
                  disabled={isClosing || disabled}
                  onClick={onClose}
                >
                  {isClosing ? <CircularProgress size={18} color="inherit" /> : <TrashIcon size={18} />}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>

        <Divider sx={{ mt: 1 }} />
        <Row label={p('ip')} value={session.last_ip} icon={<NetworkIcon size={12} />} />
        {/* Локация опциональна (только если бэк её вычислил): нет данных — Row ставит прочерк,
            строка не прячется — единая конвенция с «Локацией последнего входа» в профиле. */}
        <Row label={p('location')} value={session.location} icon={<MapPinIcon size={12} />} />
        <Row
          label={p('openedAt')}
          value={fmtLong(session.created_at, locale)}
          icon={<CalendarIcon size={12} />}
        />
        <TimeRow
          label={p('lastSeenAt')}
          value={session.last_seen_at}
          locale={locale}
          now={now}
          justNow={p('justNow')}
          icon={<ClockIcon size={12} />}
        />
        <Row
          label={p('expiresAt')}
          value={fmtLong(session.expires_at, locale)}
          icon={<HourglassIcon size={12} />}
        />
      </CardContent>
    </Card>
  );
}
