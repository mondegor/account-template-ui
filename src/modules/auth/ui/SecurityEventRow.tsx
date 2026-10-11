import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { Box, Link, Skeleton, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { RelativeTimeResult } from '@core/i18n';
import {
  securityEventDetail,
  securityEventMeta,
  securityEventTitle,
  securityEventTone,
  type SecurityEventTone,
} from '../lib/securityEvent';
import {
  AlertCircleIcon,
  LifeBuoyIcon,
  LogInIcon,
  MailIcon,
  PhoneIcon,
  PowerIcon,
  RefreshIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
} from './icons';
import type { SecurityEventType, SecurityLogItem } from '../api/types';

const GLYPH_SIZE = 16;
/** Круг под глифом: строка события выше строки Row, и глиф без подложки в ней терялся бы. */
const BADGE_SIZE = 32;

const GLYPHS: Record<SecurityEventType, ReactNode> = {
  SIGNED_IN: <LogInIcon size={GLYPH_SIZE} />,
  AUTH_2FA_ENABLED: <ShieldCheckIcon size={GLYPH_SIZE} />,
  AUTH_2FA_DISABLED: <ShieldOffIcon size={GLYPH_SIZE} />,
  RECOVERY_CODE_USED: <LifeBuoyIcon size={GLYPH_SIZE} />,
  RECOVERY_CODES_REGENERATED: <RefreshIcon size={GLYPH_SIZE} />,
  EMAIL_CHANGE_REQUESTED: <MailIcon size={GLYPH_SIZE} />,
  EMAIL_CHANGED: <MailIcon size={GLYPH_SIZE} />,
  EMAIL_CHANGE_REVOKED: <MailIcon size={GLYPH_SIZE} />,
  PHONE_CHANGED: <PhoneIcon size={GLYPH_SIZE} />,
  SESSIONS_CLOSED: <PowerIcon size={GLYPH_SIZE} />,
  TOKEN_REUSE_DETECTED: <AlertCircleIcon size={GLYPH_SIZE} />,
};

/** Нейтральный тон — без цвета палитры: обычные действия не должны спорить с тревожными. */
const PALETTE: Record<SecurityEventTone, 'success' | 'warning' | 'error' | null> = {
  neutral: null,
  success: 'success',
  warning: 'warning',
  error: 'error',
};

/**
 * Строка события журнала — одна на карточку профиля и ленту журнала: глиф в круге тона,
 * заголовок и время, деталь, мета «приложение · устройство · IP · место». Экраны отличаются
 * только временем, поэтому оно приходит готовым: в профиле относительное, в ленте — часы и
 * минуты. `title` времени — полная дата для подсказки.
 */
export function SecurityEventRow({
  item,
  time,
}: {
  item: SecurityLogItem;
  time: RelativeTimeResult;
}) {
  const { t } = useTranslation();
  const tone = PALETTE[securityEventTone(item.event_type)];
  const detail = securityEventDetail(t, item);

  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 1.5 }}>
      <Box
        sx={(theme) => ({
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color: tone ? `${tone}.main` : 'text.secondary',
          bgcolor: tone ? alpha(theme.palette[tone].main, 0.12) : 'action.hover',
        })}
      >
        {GLYPHS[item.event_type]}
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ alignItems: { sm: 'baseline' }, columnGap: 1.5 }}
        >
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, color: tone === 'error' ? 'error.main' : undefined }}
          >
            {securityEventTitle(t, item.event_type)}
          </Typography>
          <Typography
            variant="body2"
            title={time.title}
            sx={{
              ml: { sm: 'auto' },
              color: 'text.secondary',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {time.label}
          </Typography>
        </Stack>
        {detail && (
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {detail}
          </Typography>
        )}
        <Typography
          variant="caption"
          component="div"
          sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}
        >
          {securityEventMeta(item)}
        </Typography>
        {item.event_type === 'TOKEN_REUSE_DETECTED' && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {t('auth.securityLog.tokenReuseHint')}{' '}
            <Link component={RouterLink} to="/sessions">
              {t('auth.securityLog.tokenReuseLink')}
            </Link>
          </Typography>
        )}
      </Box>
    </Stack>
  );
}

/** Заглушка строки события на время загрузки: держит высоту списка, страница не прыгает. */
export function SecurityEventRowSkeleton() {
  return (
    <Stack direction="row" spacing={1.5} sx={{ py: 1.5 }}>
      <Skeleton variant="circular" width={BADGE_SIZE} height={BADGE_SIZE} sx={{ flexShrink: 0 }} />
      <Box sx={{ flex: 1 }}>
        <Skeleton variant="text" width="45%" />
        <Skeleton variant="text" width="70%" />
        <Skeleton variant="text" width="35%" sx={{ fontSize: '0.75rem' }} />
      </Box>
    </Stack>
  );
}
