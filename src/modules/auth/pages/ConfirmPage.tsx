import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { limits } from '@config';
import { AuthLayout } from '../ui/AuthLayout';
import { BrandLockup } from '../ui/BrandLockup';
import { useConfirmFlow } from '../hooks/useConfirmFlow';

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const METHOD_HINT: Record<string, string> = {
  EMAIL: 'Мы отправили код на ваш email. Введите его, чтобы продолжить.',
  PHONE: 'Мы отправили код на ваш телефон. Введите его, чтобы продолжить.',
  PASSWORD: 'Введите пароль для подтверждения.',
  TOTP: 'Введите код из приложения-аутентификатора.',
};

/** Экран узла confirmOperation. Поле/подсказка зависят от confirm_method (задел под 2FA). */
export function ConfirmPage() {
  const navigate = useNavigate();
  const flow = useConfirmFlow({
    onAccess: () => navigate('/profile', { replace: true }),
    onRevoked: () => navigate('/signin', { replace: true }),
  });
  const [code, setCode] = useState('');

  // Прямой заход без активной операции → на вход.
  if (!flow.snapshot) return <Navigate to="/signin" replace />;

  const { snapshot, expiresLeft, resendLeft, isResendApplicable } = flow;
  const exhausted = snapshot.phase === 'exhausted' || snapshot.phase === 'expired';
  const resendsLeft = snapshot.remainingResends;
  // Повтор доступен, только когда истёк кулдаун и остались отправки — независимо от фазы,
  // чтобы «Запросить новый код» в исчерпанном состоянии тоже ждал таймер.
  const resendReady =
    isResendApplicable &&
    (resendsLeft ?? 0) > 0 &&
    resendLeft === 0 &&
    !flow.submitting &&
    !flow.resending;
  const canRequestNewCode = isResendApplicable && (resendsLeft ?? 0) > 0;
  // Тупик: код вводить нельзя (попытки/срок) и повторно отправить тоже нельзя — только начать заново.
  const deadEnd = exhausted && !canRequestNewCode;
  const exhaustedAlert = deadEnd
    ? 'Превышено число попыток ввода и повторных отправок кода. Начните вход заново.'
    : snapshot.phase === 'expired'
      ? 'Срок действия кода истёк. Запросите новый код.'
      : 'Неверный код, попытки закончились. Запросите новый код.';
  // Активное состояние без ошибки, но отправок больше нет = только что использовали последнюю.
  const lastResendUsed = !exhausted && isResendApplicable && resendsLeft === 0;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await flow.confirm(code.trim());
    setCode('');
  }

  return (
    <AuthLayout>
      <Card variant="outlined" sx={{ width: 340 }}>
        <CardContent sx={{ px: 4, pt: 3, pb: 3, '&:last-child': { pb: 3 } }}>
          <BrandLockup />
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 600 }}>
            Подтверждение
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            {METHOD_HINT[snapshot.confirmMethod] ?? METHOD_HINT.EMAIL}
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
              Внимание: это была последняя повторная отправка кода.
            </Alert>
          ) : null}

          <Box component="form" onSubmit={onSubmit} noValidate>
            {/* Поле ввода прячем, когда попытки исчерпаны — вводить всё равно нельзя. */}
            {!exhausted && (
              <TextField
                label="Код подтверждения"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                fullWidth
                size="small"
                autoFocus
                inputProps={{
                  inputMode: 'numeric',
                  autoComplete: 'one-time-code',
                  minLength: limits.secret.min,
                  maxLength: limits.secret.max,
                }}
              />
            )}
            {/* Статус-строка только пока можно вводить код; в исчерпанном состоянии всё говорит алерт. */}
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
                  Осталось попыток: {snapshot.remainingAttempts}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {expiresLeft > 0 ? `Код действует ещё ${mmss(expiresLeft)}` : 'Срок кода истёк'}
                </Typography>
              </Stack>
            )}

            {exhausted ? (
              // Тупик — кнопки нет вовсе (остаётся только «Отменить» ниже).
              deadEnd ? null : (
                <Button
                  variant="contained"
                  fullWidth
                  disabled={!resendReady}
                  onClick={() => void flow.resend()}
                >
                  {resendLeft > 0
                    ? `Запросить новый код · ${mmss(resendLeft)}`
                    : 'Запросить новый код'}
                </Button>
              )
            ) : (
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={flow.submitting || code.trim().length < limits.secret.min}
              >
                Подтвердить
              </Button>
            )}
          </Box>

          {/* Нижний ряд — текстовые ссылки: повтор (с отсчётом) рядом с отменой. */}
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
                  Отправить повторно
                </Link>
              ) : (
                <Typography variant="body2" color="text.disabled">
                  {resendLeft > 0 ? `Повтор · ${mmss(resendLeft)}` : 'Отправить повторно'}
                </Typography>
              ))}
            <Link
              component="button"
              type="button"
              color="text.secondary"
              onClick={() => void flow.revoke()}
              sx={{ verticalAlign: 'baseline', fontSize: 14, lineHeight: 'inherit', p: 0 }}
            >
              Отменить
            </Link>
          </Stack>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
