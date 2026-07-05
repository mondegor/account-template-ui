import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Link, Typography } from '@mui/material';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';

/** Регистрация — тонкая обёртка: рендерит схему auth.signup. Логика — в обработчике (register.ts). */
export function SignupPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2.5 }}>
          {t('auth.signup.haveAccount')}{' '}
          <Link
            component="button"
            type="button"
            onClick={() => navigate('/signin')}
            sx={{ verticalAlign: 'baseline', fontSize: 'inherit', lineHeight: 'inherit', p: 0 }}
          >
            {t('auth.signup.signinLink')}
          </Link>
        </Typography>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signup')} />
    </AuthCard>
  );
}
