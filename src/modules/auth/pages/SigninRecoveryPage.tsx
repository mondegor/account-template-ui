import { useTranslation } from 'react-i18next';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { AuthFooterLine } from '../ui/AuthFooterLine';
import { AuthFooterNote } from '../ui/AuthFooterNote';
import { AuthNavLink } from '../ui/AuthNavLink';
import { ShieldDotsIcon } from '../ui/icons';

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
          {/* Что приготовить — сразу за кнопкой: это про предстоящий шаг формы, а не про выход с
              экрана, поэтому и стоит вплотную к ней. Знак — щит двухфакторной защиты, тот же, что
              метит её в профиле; цвет тут не украшение, а условие входа: без 2FA дальше никак. */}
          <AuthFooterNote icon={ShieldDotsIcon} tone="warning.main">
            {t('auth.signinRecovery.twoFaOnly')}
          </AuthFooterNote>
          <AuthFooterLine above="text">
            <AuthNavLink to="/signin">{t('auth.signinRecovery.emailSigninLink')}</AuthNavLink>
          </AuthFooterLine>
        </>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signinRecovery')} />
    </AuthCard>
  );
}
