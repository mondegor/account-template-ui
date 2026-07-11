import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const exhausted = snapshot.phase === 'exhausted' || snapshot.phase === 'expired';
  const resendsLeft = snapshot.remainingResends;
  const resendReady =
    isResendApplicable &&
    (resendsLeft ?? 0) > 0 &&
    resendLeft === 0 &&
    !flow.submitting &&
    !flow.resending;
  const canRequestNewCode = isResendApplicable && (resendsLeft ?? 0) > 0;
  const deadEnd = exhausted && !canRequestNewCode;
  const exhaustedAlert = deadEnd
    ? t('auth.confirm.deadEnd')
    : snapshot.phase === 'expired'
      ? t('auth.confirm.exhaustedExpired')
      : t('auth.confirm.exhaustedAttempts');
  const lastResendUsed = !exhausted && isResendApplicable && resendsLeft === 0;
  const hint = t(`auth.confirm.hint.${snapshot.confirmMethod}`, {
    defaultValue: t('auth.confirm.hint.EMAIL'),
  });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await flow.confirm(code.trim());
    setCode('');
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
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
        {!exhausted && (
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
            justifyContent="space-between"
            sx={{ mt: 1, mb: 1.5, fontSize: 12, minHeight: 20 }}
          >
            <Typography
              variant="caption"
              color={snapshot.remainingAttempts <= 1 ? 'error' : 'text.secondary'}
            >
              {t('auth.confirm.attemptsLeft', { n: snapshot.remainingAttempts })}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {expiresLeft > 0
                ? t('auth.confirm.expiresIn', { time: mmss(expiresLeft) })
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
            disabled={flow.submitting || code.trim().length < limits.secret.min}
          >
            {t('auth.confirm.submit')}
          </Button>
        )}
      </Box>

      <Stack
        direction="row"
        justifyContent="center"
        alignItems="center"
        spacing={3}
        sx={{ mt: 2, minHeight: 24 }}
      >
        {canRequestNewCode &&
          !exhausted &&
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
            <Typography variant="body2" color="text.disabled">
              {resendLeft > 0
                ? t('auth.confirm.resendTimer', { time: mmss(resendLeft) })
                : t('auth.confirm.resendLink')}
            </Typography>
          ))}
        <Link
          component="button"
          type="button"
          color="text.secondary"
          onClick={() => void flow.revoke()}
          sx={{ verticalAlign: 'baseline', fontSize: 14, lineHeight: 'inherit', p: 0 }}
        >
          {t('auth.confirm.revoke')}
        </Link>
      </Stack>
    </Box>
  );
}
