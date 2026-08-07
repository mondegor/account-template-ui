import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { fmtLong, useLocale } from '../lib/format';
import { CurrentMark } from './CurrentMark';
import { Row } from './Row';
import { TimeRow } from './TimeRow';
import {
  CalendarIcon,
  ClockIcon,
  HourglassIcon,
  MapPinIcon,
  MonitorIcon,
  NetworkIcon,
  TrashIcon,
} from './icons';
import { titleLine } from './titleLine';
import type { UserSession } from '../api/types';

/**
 * Одна открытая сессия. `current` — подпись под именем устройства и отсутствие корзины: свою
 * сессию закрывают кнопкой «Выйти» в шапке, а не отсюда, и подпись это заодно объясняет.
 */
export function SessionCard({
  session,
  variant,
  timeZone,
  now,
  onClose,
  isClosing,
  disabled,
}: {
  session: UserSession;
  variant: 'current' | 'other';
  /** Пояс профиля — приходит пропом от страницы; локаль, в отличие от него, берётся хуком. */
  timeZone?: string;
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
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction="row"
          spacing={2}
          sx={{
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          {/* Глиф-якорь слева, как в заголовках карточек профиля: устройство одно на все сессии —
              тип по названию не угадать, и выдумывать его за серверную сторону мы не будем. */}
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
            {/* Ростом со строку названия — глиф встаёт по её центру, а не по центру всей шапки:
                метит он устройство, а подпись под названием живёт своей жизнью. */}
            <Box
              sx={{
                color: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                flexShrink: 0,
                height: titleLine('subtitle1'),
              }}
            >
              <MonitorIcon size={18} />
            </Box>
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                {session.device_name}
              </Typography>
              {/* Строка под именем уже занята приложением, поэтому признак текущей сессии встаёт
                  перед ним: зелёные — только точка и слово, название приложения остаётся вторичным. */}
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                }}
              >
                {isCurrent && (
                  <>
                    <CurrentMark label={p('current')} />
                    {' · '}
                  </>
                )}
                {session.app_name}
              </Typography>
            </Stack>
          </Stack>
          {!isCurrent && (
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
                  {isClosing ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <TrashIcon size={18} />
                  )}
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
          value={fmtLong(session.created_at, locale, timeZone)}
          icon={<CalendarIcon size={12} />}
        />
        <TimeRow
          label={p('lastSeenAt')}
          value={session.last_seen_at}
          locale={locale}
          timeZone={timeZone}
          now={now}
          justNow={p('justNow')}
          icon={<ClockIcon size={12} />}
        />
        <Row
          label={p('expiresAt')}
          value={fmtLong(session.expires_at, locale, timeZone)}
          icon={<HourglassIcon size={12} />}
        />
      </CardContent>
    </Card>
  );
}
