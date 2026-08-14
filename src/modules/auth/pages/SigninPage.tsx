import { useTranslation } from 'react-i18next';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { AuthFooterLine } from '../ui/AuthFooterLine';
import { AuthNavLink } from '../ui/AuthNavLink';

/** Вход — тонкая обёртка: рендерит схему auth.signin. Логика — в обработчике (register.ts). */
export function SigninPage() {
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <>
          <AuthFooterLine>
            {t('auth.signin.noAccount')}{' '}
            <AuthNavLink to="/signup">{t('auth.signin.signupLink')}</AuthNavLink>
          </AuthFooterLine>
          {/* Резервный вход — второй строкой: он для узкого случая (потерян доступ к почте),
              и путать его с обычным входом на равных не стоит. */}
          <AuthFooterLine above="tight">
            {t('auth.signin.emailTrouble')}{' '}
            <AuthNavLink to="/signin/recovery">{t('auth.signin.recoveryLink')}</AuthNavLink>
          </AuthFooterLine>
        </>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signin')} />
    </AuthCard>
  );
}
