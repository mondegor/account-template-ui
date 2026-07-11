import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Link, Typography } from '@mui/material';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';

/** Вход — тонкая обёртка: рендерит схему auth.signin. Логика — в обработчике (register.ts). */
export function SigninPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 2.5 }}>
          {t('auth.signin.noAccount')}{' '}
          <Link
            component="button"
            type="button"
            onClick={() => navigate('/signup')}
            sx={{ verticalAlign: 'baseline', fontSize: 'inherit', lineHeight: 'inherit', p: 0 }}
          >
            {t('auth.signin.signupLink')}
          </Link>
        </Typography>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signin')} />
    </AuthCard>
  );
}
