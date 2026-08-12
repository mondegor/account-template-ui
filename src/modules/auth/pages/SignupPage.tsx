import { useTranslation } from 'react-i18next';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { AuthFooterLine } from '../ui/AuthFooterLine';
import { AuthNavLink } from '../ui/AuthNavLink';

/** Регистрация — тонкая обёртка: рендерит схему auth.signup. Логика — в обработчике (register.ts). */
export function SignupPage() {
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <AuthFooterLine>
          {t('auth.signup.haveAccount')}{' '}
          <AuthNavLink to="/signin">{t('auth.signup.signinLink')}</AuthNavLink>
        </AuthFooterLine>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signup')} />
    </AuthCard>
  );
}
