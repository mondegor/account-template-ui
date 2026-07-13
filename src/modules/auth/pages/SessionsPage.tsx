import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { AppShell } from '@core/shell';
import { realmProvider } from '@core/auth';
import { moduleQueryKey } from '@core/module-registry';
import { closeUserSessions, getUserInfo, getUserSessions } from '../api/authApi';
import { useNow } from '../lib/format';
import { SessionCard } from '../ui/SessionCard';
import { SessionsHeader } from '../ui/SessionsHeader';
import { StopHandIcon } from '../ui/icons';

/**
 * Открытые сессии выбранного реалма. Текущая сессия выделяется отдельно — но только в реалме
 * деплоя (realmProvider): в UserSession нет поля realm, а is_current сервер считает относительно
 * текущей сессии, так что в чужом реалме её попросту нет.
 *
 * Закрытие — всегда POST /v1/sessions/close (и одной, и пачкой); DELETE /v1/session — это выход.
 */
export function SessionsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.sessions.${key}`, opts ?? {});

  const user = useQuery({ queryKey: moduleQueryKey('auth', 'user'), queryFn: getUserInfo });
  const currentRealm = realmProvider.getRealm();
  const [selected, setSelected] = useState<string | null>(null);
  // Тик «N минут назад» один на весь список: иначе каждая карточка держала бы свой setInterval.
  const now = useNow(60_000);

  const realms = user.data?.realms ?? [];
  // Выбор пользователя действует, только пока такой кабинет у него есть: профиль мог перезапроситься
  // и потерять реалм (доступ отозвали) — иначе Select получил бы value вне списка, а запрос уходил бы
  // в чужой кабинет.
  const picked = realms.some((r) => r.name === selected) ? selected : null;
  const effective = picked ?? realms.find((r) => r.name === currentRealm)?.name ?? realms[0]?.name;
  const sessionsKey = moduleQueryKey('auth', 'sessions', effective ?? '');

  const sessions = useQuery({
    queryKey: sessionsKey,
    queryFn: () => getUserSessions(effective),
    enabled: Boolean(effective),
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  // single различает клик по корзине конкретной сессии и «закрыть все»: по длине массива их не
  // отличить — массовое закрытие единственной чужой сессии тоже шлёт один id.
  const close = useMutation({
    mutationFn: ({ ids }: { ids: string[]; single: boolean }) => closeUserSessions(ids),
    // Префикс, а не sessionsKey этого рендера: пока запрос в полёте, кабинет могли переключить —
    // тогда инвалидировался бы ключ нового кабинета, а список того, где сессию реально закрыли,
    // остался бы в кэше со старой сессией.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: moduleQueryKey('auth', 'sessions') }),
  });

  // Какая карточка закрывается, узнаём из самой мутации: single-закрытие — клик по корзине конкретной
  // сессии, и только пока запрос в полёте.
  const closingId =
    close.isPending && close.variables?.single ? (close.variables.ids[0] ?? null) : null;

  const list = sessions.data ?? [];
  // is_current осмыслен только в своём реалме; в чужом «текущей» сессии не существует.
  const current = effective === currentRealm ? list.find((s) => s.is_current) : undefined;
  const others = list.filter((s) => !s.is_current);
  // Мутация одна на всю страницу, поэтому и закрытие идёт по одному за раз: пока запрос в полёте,
  // остальные кнопки закрытия выключены. Иначе второй mutate() перетирал бы pending-состояние
  // первого — спиннер гас бы на карточке, чей запрос ещё не вернулся.
  const bulkPending = close.isPending && !close.variables?.single;

  const closeOthers = () => {
    setConfirmOpen(false);
    // Диалог мог остаться открытым после того, как список опустел (закрыли последнюю чужую сессию
    // одиночной кнопкой) — пустой mutate([]) ушёл бы в бэк и вернулся 422 «укажите хотя бы одну».
    if (others.length === 0) return;
    close.mutate({ ids: others.map((s) => s.session_id), single: false });
  };

  // Ошибка закрытия относилась к прошлому списку — вместе с ним и уходит: иначе алерт висел бы над
  // корректно загруженными сессиями другого кабинета до следующего закрытия. Но только когда запрос
  // не в полёте: reset() посреди pending снял бы disabled с корзин нового кабинета и пустил второй
  // параллельный mutate. Ошибка живёт лишь в не-pending состоянии, так что алерт всё равно очистится.
  const selectRealm = (realm: string) => {
    setSelected(realm);
    if (!close.isPending) close.reset();
  };

  const listError = (sessions.error ?? null) as Error | null;

  // Спиннер на весь экран — только пока нет профиля. Смена реалма перезагружает список, но
  // заголовок с комбобоксом должен остаться на месте, иначе страница «моргает» целиком.
  if (user.isLoading) {
    return (
      <AppShell>
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      </AppShell>
    );
  }

  // Упал профиль, а не список сессий: список без реалмов даже не запрашивался — и текст про него
  // сбивал бы с толку.
  if (user.isError) {
    return (
      <AppShell>
        <Alert severity="error" sx={{ maxWidth: 880, mx: 'auto' }}>
          {t('auth.profile.loadError', { message: (user.error as Error | null)?.message })}
        </Alert>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto' }}>
        <SessionsHeader realms={realms} value={effective ?? ''} onChange={selectRealm} />

        {/* Ни одного кабинета — запрос сессий даже не уходит (нет realm), так что и спиннера,
            и ошибки не будет: без явного сообщения страница осталась бы просто пустой. */}
        {!effective && <Alert severity="info">{p('noRealms')}</Alert>}

        {/* Ошибка закрытия не должна ронять список — показываем над ним. */}
        {close.isError && <Alert severity="error">{p('closeError')}</Alert>}

        {sessions.isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {sessions.isError && (
          <Alert severity="error">{p('loadError', { message: listError?.message })}</Alert>
        )}

        {sessions.isSuccess && (
          <>
            {/* Подписи над карточкой нет: её метит чип «Текущая» и акцентная рамка. */}
            {current && <SessionCard session={current} variant="current" now={now} />}

            <Button
              fullWidth
              color="error"
              variant="outlined"
              size="large"
              startIcon={
                bulkPending ? <CircularProgress size={20} color="inherit" /> : <StopHandIcon />
              }
              disabled={others.length === 0 || close.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {current ? p('terminateOthers') : p('terminateAll')}
            </Button>

            <Typography variant="subtitle2" color="text.secondary">
              {current
                ? p('otherSessions', { n: others.length })
                : p('allSessions', { n: others.length })}
            </Typography>

            {others.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {p('empty')}
              </Typography>
            ) : (
              others.map((s) => (
                <SessionCard
                  key={s.session_id}
                  session={s}
                  variant="other"
                  now={now}
                  isClosing={closingId === s.session_id}
                  disabled={close.isPending}
                  onClose={() => close.mutate({ ids: [s.session_id], single: true })}
                />
              ))
            )}
          </>
        )}
      </Stack>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{p('confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{p('confirmText', { n: others.length })}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{p('cancel')}</Button>
          {/* Диалог мог быть открыт до того, как началось закрытие одиночной сессии. */}
          <Button color="error" onClick={closeOthers} disabled={close.isPending} autoFocus>
            {p('confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </AppShell>
  );
}
