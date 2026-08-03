import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Link, Stack, TextField, Typography } from '@mui/material';
import { limits } from '@config';
import type { NodeComponentProps } from '@core/schema';
import { useConfirmFlow } from '../hooks/useConfirmFlow';
import { clearConfirmReturn, loadConfirmReturn } from '../lib/confirmReturn';

/**
 * Узел схемы `confirmOperation` (регистрируется модулем auth). Обёртка над generic-движком:
 * читает confirm_method, рисует ввод, счётчики attempts/resends/expires и кнопки
 * повтора/отмены/«запросить новый код». Терминальное действие и навигация — auth-специфика
 * (openSession в useConfirmFlow, редиректы здесь).
 */

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function ConfirmOperationNode(_props: NodeComponentProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Экран /confirm общий для signup/signin — «Отменить» возвращает на исходный экран, запомненный
  // обработчиком потока в sessionStorage (переживает reload; дефолт — вход). НЕ чистим здесь до
  // навигации: revoke() сначала делает reset() снапшота, из-за чего ConfirmPage (подписан на
  // снапшот) успевает сам редиректнуть по loadConfirmReturn() — оба выхода должны вести в одно место.
  const flow = useConfirmFlow({
    onAccess: () => {
      clearConfirmReturn();
      navigate('/profile', { replace: true });
    },
    onRevoked: () => navigate(loadConfirmReturn(), { replace: true }),
  });
  const [code, setCode] = useState('');

  if (!flow.snapshot) return null;

  const { snapshot, expiresLeft, resendLeft, isResendApplicable } = flow;
  // Операцию завершить нельзя ничем — ни вводом кода, ни новым кодом, ни ожиданием: сервер снял
  // условие её создания (409), отказал в самом действии (403), не принял её токен (400 по
  // OperationInvalid/OperationAlreadyExpired) либо истёк срок уже подтверждённой (см. ниже).
  // Дальше она ведёт себя как тупик, поэтому попадает в exhausted.
  const dead = snapshot.phase === 'dead';
  const exhausted = dead || snapshot.phase === 'exhausted' || snapshot.phase === 'expired';
  // Код уже принят, сорвалось только терминальное действие: вводить нечего и подтверждать нечего —
  // экран сводится к «Повторить» и таймеру остатка жизни операции.
  const awaitingFinish = flow.awaitingFinish && !exhausted;
  const resendsLeft = snapshot.remainingResends;
  const resendReady =
    isResendApplicable &&
    (resendsLeft ?? 0) > 0 &&
    resendLeft === 0 &&
    !flow.submitting &&
    !flow.resending;
  const canRequestNewCode = isResendApplicable && (resendsLeft ?? 0) > 0;
  // У аннулированной операции запрашивать новый код тоже не у чего — тупик независимо от остатка.
  const deadEnd = dead || (exhausted && !canRequestNewCode);
  // У аннулированной операции причину знает только сервер («2FA была отключена», «доступ к контуру
  // отозван»), и общий текст её не заменяет: без неё пользователю не отличить свою ошибку от
  // изменившихся обстоятельств. Запасной вариант нужен для истечения ПОДТВЕРЖДЁННОЙ операции —
  // туда приводит локальный TICK, и отказа сервера там не было вовсе.
  const exhaustedAlert = dead
    ? (flow.error ?? t('auth.confirm.invalidated'))
    : deadEnd
      ? t('auth.confirm.deadEnd')
      : snapshot.phase === 'expired'
        ? t('auth.confirm.exhaustedExpired')
        : t('auth.confirm.exhaustedAttempts');
  const lastResendUsed = !exhausted && !awaitingFinish && isResendApplicable && resendsLeft === 0;
  const hint = awaitingFinish
    ? t('auth.confirm.awaitingFinish')
    : t(`auth.confirm.hint.${snapshot.confirmMethod}`, {
        defaultValue: t('auth.confirm.hint.EMAIL'),
      });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await flow.confirm(code.trim());
    setCode('');
  }

  return (
    <Box>
      <Typography
        variant="body2"
        sx={{
          color: 'text.secondary',
          mt: 0.5,
          mb: 2,
        }}
      >
        {hint}
      </Typography>
      {exhausted ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {exhaustedAlert}
        </Alert>
      ) : flow.error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {flow.error}
        </Alert>
      ) : lastResendUsed ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('auth.confirm.lastResend')}
        </Alert>
      ) : null}
      <Box component="form" onSubmit={onSubmit} noValidate>
        {!exhausted && !awaitingFinish && (
          <TextField
            label={t('auth.field.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            fullWidth
            size="small"
            autoFocus
            slotProps={{
              htmlInput: {
                inputMode: 'numeric',
                autoComplete: 'off',
                minLength: limits.secret.min,
                maxLength: limits.secret.max,
              },
            }}
          />
        )}
        {!exhausted && (
          <Stack
            direction="row"
            sx={{
              justifyContent: 'space-between',
              mt: 1,
              mb: 1.5,
              fontSize: 12,
              minHeight: 20,
            }}
          >
            {/* Попытки ввода к повтору входа не относятся: код уже принят. */}
            {!awaitingFinish && (
              <Typography
                variant="caption"
                sx={{ color: snapshot.remainingAttempts <= 1 ? 'error.main' : 'text.secondary' }}
              >
                {t('auth.confirm.attemptsLeft', { n: snapshot.remainingAttempts })}
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{
                color: 'text.secondary',
                ml: 'auto',
              }}
            >
              {expiresLeft > 0
                ? t(awaitingFinish ? 'auth.confirm.finishExpiresIn' : 'auth.confirm.expiresIn', {
                    time: mmss(expiresLeft),
                  })
                : t('auth.confirm.expired')}
            </Typography>
          </Stack>
        )}

        {exhausted ? (
          deadEnd ? null : (
            <Button
              variant="contained"
              fullWidth
              disabled={!resendReady}
              onClick={() => void flow.resend()}
            >
              {resendLeft > 0
                ? t('auth.confirm.requestNewCodeTimer', { time: mmss(resendLeft) })
                : t('auth.confirm.requestNewCode')}
            </Button>
          )
        ) : (
          <Button
            type="submit"
            variant="contained"
            fullWidth
            disabled={
              flow.submitting || (!awaitingFinish && code.trim().length < limits.secret.min)
            }
          >
            {t(awaitingFinish ? 'auth.confirm.retryFinish' : 'auth.confirm.submit')}
          </Button>
        )}
      </Box>
      <Stack
        direction="row"
        spacing={3}
        sx={{
          justifyContent: 'center',
          alignItems: 'center',
          mt: 2,
          minHeight: 24,
        }}
      >
        {/* Повторная отправка кода подтверждённой операции бессмысленна — только «Отменить». */}
        {canRequestNewCode &&
          !exhausted &&
          !awaitingFinish &&
          (resendReady ? (
            <Link
              component="button"
              type="button"
              onClick={() => void flow.resend()}
              sx={{ verticalAlign: 'baseline', fontSize: 14, lineHeight: 'inherit', p: 0 }}
            >
              {t('auth.confirm.resendLink')}
            </Link>
          ) : (
            <Typography
              variant="body2"
              sx={{
                color: 'text.disabled',
              }}
            >
              {resendLeft > 0
                ? t('auth.confirm.resendTimer', { time: mmss(resendLeft) })
                : t('auth.confirm.resendLink')}
            </Typography>
          ))}
        <Link
          component="button"
          type="button"
          onClick={() => void flow.revoke()}
          sx={{
            color: 'text.secondary',
            verticalAlign: 'baseline',
            fontSize: 14,
            lineHeight: 'inherit',
            p: 0,
          }}
        >
          {t('auth.confirm.revoke')}
        </Link>
      </Stack>
    </Box>
  );
}
