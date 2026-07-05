import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, Link, TextField, Typography } from '@mui/material';
import { limits } from '@config';
import { useOperationStore } from '@core/operation';
import { ApiFieldError, ApiProblemError } from '@core/api';
import { AuthLayout } from '../ui/AuthLayout';
import { BrandLockup } from '../ui/BrandLockup';
import { validateUserLogin } from '../lib/userLogin';
import { signin } from '../api/authApi';

/** Шаг 1 входа: ввод email/телефона. Realm задаётся конфигом и в форме не показывается. */
export function SigninPage() {
  const navigate = useNavigate();
  const dispatch = useOperationStore((s) => s.dispatch);
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // Валидация только по нажатию — не дёргаем юзера ошибкой во время ввода.
    const msg = validateUserLogin(login);
    if (msg) {
      setFieldError(msg);
      return;
    }
    setFieldError(null);
    setSubmitting(true);
    try {
      const op = await signin(login.trim());
      dispatch({ type: 'START', parts: op, now: Date.now() });
      navigate('/confirm');
    } catch (err) {
      if (err instanceof ApiFieldError) setFieldError(err.fields[0]?.detail ?? 'Проверьте логин');
      else if (err instanceof ApiProblemError) setError(err.details.detail || err.details.title);
      else setError('Не удалось выполнить вход. Попробуйте позже.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout>
      <Card variant="outlined" sx={{ width: 340 }}>
        <CardContent sx={{ px: 4, pt: 3, pb: 4, '&:last-child': { pb: 4 } }}>
          <BrandLockup />
          <Typography variant="h6" sx={{ mt: 2, fontWeight: 600 }}>
            Вход в аккаунт
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
            Укажите email или телефон — на него придёт код для входа.
          </Typography>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField
              label="Email или телефон"
              value={login}
              onChange={(e) => {
                setLogin(e.target.value);
                if (fieldError) setFieldError(null); // ошибка исчезает, как только юзер правит ввод
              }}
              fullWidth
              size="small"
              autoFocus
              inputProps={{ maxLength: limits.userLogin.max }}
              error={!!fieldError}
              helperText={fieldError ?? ' '}
            />
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={submitting}
              sx={{ mt: 1 }}
            >
              Войти
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2.5 }}>
            Нет аккаунта?{' '}
            <Link
              component="button"
              type="button"
              onClick={() => navigate('/signup')}
              sx={{ verticalAlign: 'baseline', fontSize: 'inherit', lineHeight: 'inherit', p: 0 }}
            >
              Зарегистрироваться
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
