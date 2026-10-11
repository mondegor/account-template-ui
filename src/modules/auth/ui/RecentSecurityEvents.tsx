import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { Alert, Button, Card, CardContent, Divider, Link, Typography } from '@mui/material';
import { apiErrorText } from '@core/api';
import { formatRelativeTime } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { getSecurityLog } from '../api/authApi';
import { useLocale } from '../lib/format';
import { CardHeading } from './CardHeading';
import { SecurityEventRow, SecurityEventRowSkeleton } from './SecurityEventRow';
import { FileTextIcon } from './icons';

/** Сколько последних событий показывает профиль; остальное — на странице журнала. */
const RECENT_LIMIT = 3;

/**
 * Карточка «Последние события» в профиле: три свежих события журнала и ссылка на весь журнал.
 * Запрос свой (тот же endpoint с limit=3), поэтому сбой журнала гасит только эту карточку —
 * профиль над ней остаётся на месте. Время — относительное, как «Последний вход» в карточке
 * кабинета; тик `now` общий со страницей.
 */
export function RecentSecurityEvents({ timeZone, now }: { timeZone?: string; now: number }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const s = (key: string) => t(`auth.securityLog.${key}`);
  const log = useQuery({
    queryKey: moduleQueryKey('auth', 'securityLog', 'recent'),
    queryFn: () => getSecurityLog({ limit: RECENT_LIMIT }),
  });
  const items = log.data?.items;

  return (
    <Card variant="outlined">
      <CardContent>
        <CardHeading
          icon={<FileTextIcon size={18} />}
          title={s('recentTitle')}
          action={
            <Link component={RouterLink} to="/security/log" variant="body2">
              {s('allLink')}
            </Link>
          }
        />
        <Divider />
        {log.isPending && (
          <>
            <SecurityEventRowSkeleton />
            <SecurityEventRowSkeleton />
            <SecurityEventRowSkeleton />
          </>
        )}
        {log.isError && (
          <Alert
            severity="error"
            sx={{ mt: 1.5 }}
            action={
              <Button color="inherit" size="small" onClick={() => void log.refetch()}>
                {s('retry')}
              </Button>
            }
          >
            {apiErrorText(log.error, t)}
          </Alert>
        )}
        {items?.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', pt: 1.5 }}>
            {s('empty')}
          </Typography>
        )}
        {items?.map((item, i) => (
          <Fragment key={item.id}>
            {i > 0 && <Divider />}
            <SecurityEventRow
              item={item}
              time={
                formatRelativeTime(item.created_at, {
                  locale,
                  now,
                  justNow: s('justNow'),
                  timeZone,
                }) ?? { label: item.created_at, title: item.created_at }
              }
            />
          </Fragment>
        ))}
      </CardContent>
    </Card>
  );
}
