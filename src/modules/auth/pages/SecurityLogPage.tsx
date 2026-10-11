import { Fragment, useEffect, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { PAGE_MAX_WIDTH } from '@ui';
import { AppShell } from '@core/shell';
import { apiErrorText } from '@core/api';
import { formatDateTimeLong, resolveTimeZone } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { getSecurityLog, getUserInfo } from '../api/authApi';
import { dayGroup, fmtTime, useLocale, useNow } from '../lib/format';
import { SecurityEventRow, SecurityEventRowSkeleton } from '../ui/SecurityEventRow';
import type { SecurityLogItem } from '../api/types';

/** Размер страницы журнала — он же размер догрузки при прокрутке. */
const PAGE_LIMIT = 10;

/** Догрузку начинаем заранее, пока до конца ленты ещё есть запас прокрутки. */
const SENTINEL_MARGIN = '200px';

/**
 * Невидимая метка в конце ленты: попала в видимую область — пора за следующей страницей.
 * Наблюдатель пересоздаётся на каждую загруженную страницу (`pages`): новый сразу сообщает текущее
 * пересечение, и если короткая страница не дотянула ленту до низа экрана, метка видна по-прежнему
 * и запрос уходит снова. Иначе пересечение не менялось бы и догрузка встала.
 */
function Sentinel({ pages, onVisible }: { pages: number; onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisibleRef.current();
      },
      { rootMargin: SENTINEL_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [pages]);

  return <Box ref={ref} data-testid="security-log-sentinel" />;
}

/**
 * Лента событий, разбитая на дни в поясе профиля: «Сегодня», «Вчера», «8 октября». Внутри дня
 * строки разделены линией, у дня — подпись сверху.
 */
function Feed({
  items,
  timeZone,
  now,
}: {
  items: SecurityLogItem[];
  timeZone?: string;
  now: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const opts = {
    locale,
    timeZone,
    now,
    today: t('auth.securityLog.today'),
    yesterday: t('auth.securityLog.yesterday'),
  };

  let day = '';
  return items.map((item) => {
    const group = dayGroup(item.created_at, opts);
    const first = group.key !== day;
    day = group.key;
    const d = new Date(item.created_at);
    const title = Number.isNaN(d.getTime())
      ? item.created_at
      : formatDateTimeLong(d, locale, timeZone);
    return (
      <Fragment key={item.id}>
        {first ? (
          <Typography
            variant="overline"
            component="h2"
            sx={{ display: 'block', color: 'text.secondary', pt: 1.5, lineHeight: 2 }}
          >
            {group.label}
          </Typography>
        ) : (
          <Divider />
        )}
        <SecurityEventRow
          item={item}
          time={{ label: fmtTime(item.created_at, locale, timeZone), title }}
        />
      </Fragment>
    );
  });
}

/**
 * Журнал безопасности (/security/log): события от свежих к старым, по 10 записей; следующие 10
 * подгружаются, когда метка в конце ленты попадает в видимую область. Сбой догрузки встаёт плашкой
 * в конце ленты с «Повторить» — загруженное остаётся, а метка снимается, чтобы прокрутка не
 * повторяла упавший запрос сама.
 *
 * Профиль нужен ради пояса: дни и время считаются в поясе профиля, как прочие даты аккаунта.
 */
export function SecurityLogPage() {
  const { t } = useTranslation();
  const s = (key: string) => t(`auth.securityLog.${key}`);
  const now = useNow(60_000);

  const user = useQuery({ queryKey: moduleQueryKey('auth', 'user'), queryFn: getUserInfo });
  const log = useInfiniteQuery({
    queryKey: moduleQueryKey('auth', 'securityLog', 'feed'),
    queryFn: ({ pageParam }) => getSecurityLog({ cursor: pageParam, limit: PAGE_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.cursor,
    // Лента не переживает уход со страницы. Иначе при возврате react-query перечитал бы подряд
    // все прокрученные страницы, а сбой такого перечитывания не виден: на экране осталась бы
    // прежняя лента без ошибки. Возврат начинается с первой страницы, как первый заход.
    gcTime: 0,
  });
  const timeZone = resolveTimeZone(user.data?.tz);

  const items = log.data?.pages.flatMap((page) => page.items) ?? [];
  const pages = log.data?.pages.length ?? 0;
  const loadNext = () => {
    if (log.hasNextPage && !log.isFetchingNextPage && !log.isFetchNextPageError) {
      void log.fetchNextPage();
    }
  };

  // Ленту рисуем, только когда известен пояс: иначе дни пересобрались бы после прихода профиля.
  const pending = user.isPending || log.isPending;
  // Баннер вместо ленты — только пока данных нет: сбой фонового перечитывания (профиль из кэша
  // перечитывается при заходе) оставляет прежние данные, и ленту прятать незачем.
  const firstError =
    (user.isError && !user.data ? user.error : null) ??
    (log.isError && !log.data ? log.error : null);

  return (
    <AppShell>
      <Stack spacing={2} sx={{ maxWidth: PAGE_MAX_WIDTH, mx: 'auto' }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          {s('title')}
        </Typography>

        {firstError ? (
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  // Упасть могли оба запроса — повторяем каждый упавший, а не только первый.
                  if (user.isError) void user.refetch();
                  if (log.isError) void log.refetch();
                }}
              >
                {s('retry')}
              </Button>
            }
          >
            {apiErrorText(firstError, t)}
          </Alert>
        ) : (
          <Card variant="outlined">
            <CardContent sx={{ pt: 0.5, pb: 1, '&:last-child': { pb: 1 } }}>
              {pending && (
                <Box sx={{ pt: 1 }}>
                  <SecurityEventRowSkeleton />
                  <SecurityEventRowSkeleton />
                  <SecurityEventRowSkeleton />
                  <SecurityEventRowSkeleton />
                </Box>
              )}

              {!pending && items.length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
                  {s('empty')}
                </Typography>
              )}

              {!pending && <Feed items={items} timeZone={timeZone} now={now} />}

              {log.isFetchingNextPage && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                  <CircularProgress size={24} />
                </Box>
              )}

              {/* Ошибка держится до успешного ответа, поэтому на время повтора плашку прячем —
                  иначе она висела бы под спиннером с живой кнопкой «Повторить». */}
              {log.isFetchNextPageError && !log.isFetchingNextPage && (
                <Alert
                  severity="error"
                  sx={{ my: 1.5 }}
                  action={
                    <Button color="inherit" size="small" onClick={() => void log.fetchNextPage()}>
                      {s('retry')}
                    </Button>
                  }
                >
                  {apiErrorText(log.error, t)}
                </Alert>
              )}

              {!pending && log.hasNextPage && !log.isFetchNextPageError && (
                <Sentinel pages={pages} onVisible={loadNext} />
              )}

              {!pending && !log.hasNextPage && items.length > 0 && (
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', textAlign: 'center', py: 2 }}
                >
                  {s('end')}
                </Typography>
              )}
            </CardContent>
          </Card>
        )}
      </Stack>
    </AppShell>
  );
}
