import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Link, TextField, Typography } from '@mui/material';
import { limits } from '@config';
import { useOperationStore } from '@core/operation';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { AuthLayout } from '../ui/AuthLayout';
import { BrandLockup } from '../ui/BrandLockup';
import { validateEmail } from '../lib/userLogin';
import { checkLogin, signup } from '../api/authApi';

/** Через сколько мс после остановки печати проверяем доступность email (не долбим ручку). */
const CHECK_DEBOUNCE_MS = 700;

type CheckState = 'idle' | 'checking' | 'free' | 'taken';

/** Шаг 1 регистрации: ввод email. Realm задаётся конфигом и в форме не показывается. */
export function SignupPage() {
  const navigate = useNavigate();
  const dispatch = useOperationStore((s) => s.dispatch);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkState, setCheckState] = useState<CheckState>('idle');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emailRef = useRef(''); // актуальное значение поля — для отсева устаревших ответов
  // Кэш детерминированных исходов проверки по значению: дедуп запросов + восстановление статуса
  // при возврате к ранее проверенному email. Транзиентные (сетевые) ошибки не кэшируем.
  const resultCache = useRef<Map<string, { state: 'free' | 'taken'; error: string | null }>>(
    new Map(),
  );

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  useEffect(() => clearTimer, []); // чистим таймер на unmount

  /** Асинк-проверка доступности одного значения. Результат применяем, только если поле не изменилось. */
  async function runCheck(value: string) {
    setCheckState('checking');
    try {
      await checkLogin(value.trim());
      resultCache.current.set(value, { state: 'free', error: null });
      if (emailRef.current !== value) return; // ответ устарел — юзер уже правит дальше
      setCheckState('free');
      setFieldError(null);
    } catch (err) {
      if (err instanceof ApiFieldError) {
        const detail = err.fields[0]?.detail ?? 'Этот email уже зарегистрирован';
        resultCache.current.set(value, { state: 'taken', error: detail });
        if (emailRef.current !== value) return;
        setCheckState('taken');
        setFieldError(detail);
      } else if (emailRef.current === value) {
        setCheckState('idle'); // сеть/прочее — тихо, не кэшируем (сервер проверит на сабмите)
      }
    }
  }

  function onChange(value: string) {
    setEmail(value);
    emailRef.current = value;
    if (error) setError(null); // правка поля убирает верхний алерт прошлой попытки
    clearTimer();
    // Уже проверяли с детерминированным исходом → восстановить статус, ничего не шлём.
    const cached = resultCache.current.get(value);
    if (cached) {
      setCheckState(cached.state);
      setFieldError(cached.error);
      return;
    }
    if (fieldError) setFieldError(null);
    setCheckState('idle');
    // Ручку дёргаем только для валидного формата и лишь после паузы в наборе.
    timerRef.current = setTimeout(() => {
      if (validateEmail(value) === null) void runCheck(value);
    }, CHECK_DEBOUNCE_MS);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    clearTimer();
    const msg = validateEmail(email);
    if (msg) {
      setFieldError(msg);
      return;
    }
    if (checkState === 'taken') return; // ошибка уже под полем, серверу не шлём
    setFieldError(null);
    setSubmitting(true);
    try {
      const op = await signup(email.trim());
      dispatch({ type: 'START', parts: op, now: Date.now() });
      navigate('/confirm');
    } catch (err) {
      if (err instanceof ApiFieldError) {
        // Ошибка формата поля → под поле; бизнес-блок (лок регистрации) → верхний алерт.
        if (err.fields[0]?.code === 'user_email') {
          setFieldError(err.fields[0]?.detail ?? 'Проверьте email');
        } else {
          setError(
            err.fields[0]?.detail ?? 'Заявка на регистрацию уже обрабатывается. Попробуйте позже.',
          );
        }
      } else if (err instanceof ApiProblemError) setError(err.details.detail || err.details.title);
      else setError('Не удалось зарегистрироваться. Попробуйте позже.');
    } finally {
      setSubmitting(false);
    }
  }

  // Зелёную подсветку показываем, только если нет верхней ошибки сабмита (лок и т.п.).
  const showFree = checkState === 'free' && !error;

  return (
    <AuthLayout>
      <Card variant="outlined" sx={{ width: 340 }}>
        <CardContent sx={{ px: 4, pt: 3, pb: 4, '&:last-child': { pb: 4 } }}>
          <BrandLockup />
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 600 }}>
            Создание аккаунта
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
            Укажите email — на него придёт код для подтверждения регистрации.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => onChange(e.target.value)}
              fullWidth
              size="small"
              autoFocus
              inputProps={{ maxLength: limits.userLogin.max, autoComplete: 'email' }}
              error={!!fieldError}
              helperText={
                fieldError ??
                (checkState === 'checking'
                  ? 'Проверяем доступность…'
                  : showFree
                    ? 'Email свободен'
                    : ' ')
              }
              // Свободный email — зелёная рамка/подпись как явный сигнал «можно регистрироваться».
              // Гасим зелёное, если есть верхняя ошибка (напр. лок регистрации) — иначе противоречие.
              color={showFree ? 'success' : undefined}
              focused={showFree || undefined}
              sx={showFree ? { '& .MuiFormHelperText-root': { color: 'success.main' } } : undefined}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={submitting || checkState === 'taken'}
              sx={{ mt: 1 }}
            >
              Зарегистрироваться
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2.5 }}>
            Уже есть аккаунт?{' '}
            <Link
              component="button"
              type="button"
              onClick={() => navigate('/signin')}
              sx={{ verticalAlign: 'baseline', fontSize: 'inherit', lineHeight: 'inherit', p: 0 }}
            >
              Войти
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
