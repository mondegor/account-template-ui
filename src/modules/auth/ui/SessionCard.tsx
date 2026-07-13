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
import { formatRelativeTime } from '@core/i18n';
import { fmt, useLocale } from '../lib/format';
import { Row } from './Row';
import { TrashIcon } from './icons';
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
  const seen = formatRelativeTime(session.last_seen_at, { locale, now, justNow: p('justNow') });
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
                  {isClosing ? <CircularProgress size={20} color="inherit" /> : <TrashIcon />}
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Stack>

        <Divider sx={{ mt: 1 }} />
        <Row label={p('ip')} value={session.last_ip} />
        <Row label={p('location')} value={session.location} />
        <Row label={p('createdAt')} value={fmt(session.created_at, locale)} />
        <Row
          label={p('lastSeenAt')}
          value={seen ? seen.label : fmt(session.last_seen_at, locale)}
          title={seen?.title}
        />
      </CardContent>
    </Card>
  );
}
