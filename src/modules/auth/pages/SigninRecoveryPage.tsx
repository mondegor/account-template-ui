import { useTranslation } from 'react-i18next';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { AuthFooterLine } from '../ui/AuthFooterLine';
import { AuthFooterNote } from '../ui/AuthFooterNote';
import { AuthNavLink } from '../ui/AuthNavLink';

/**
 * Резервный вход — тонкая обёртка над схемой auth.signinRecovery. Логика та же, что у обычного
 * входа, и отличается только методом-инициатором (register.ts). Ссылки на регистрацию в футере
 * нет: сюда приходят с уже существующим аккаунтом, единственный нужный отсюда путь — обычный вход.
 */
export function SigninRecoveryPage() {
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <>
          <AuthFooterLine>
            {t('auth.signinRecovery.emailSigninPrompt')}{' '}
            <AuthNavLink to="/signin">{t('auth.signinRecovery.emailSigninLink')}</AuthNavLink>
          </AuthFooterLine>
          {/* Что приготовить — последней строкой: до формы это оговорка, а после неё подсказка
              на следующий шаг, где эти доказательства и спросят. */}
          <AuthFooterNote>{t('auth.signinRecovery.twoFaOnly')}</AuthFooterNote>
        </>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signinRecovery')} />
    </AuthCard>
  );
}
