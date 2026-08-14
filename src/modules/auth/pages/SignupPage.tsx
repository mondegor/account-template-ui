import { useTranslation } from 'react-i18next';
import { config } from '@config';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AuthCard } from '../ui/AuthCard';
import { AuthExternalLink } from '../ui/AuthExternalLink';
import { AuthFooterLine } from '../ui/AuthFooterLine';
import { AuthFooterNote } from '../ui/AuthFooterNote';
import { AuthNavLink } from '../ui/AuthNavLink';
import { FileTextIcon } from '../ui/icons';

/** Регистрация — тонкая обёртка: рендерит схему auth.signup. Логика — в обработчике (register.ts). */
export function SignupPage() {
  const { t } = useTranslation();
  return (
    <AuthCard
      footer={
        <>
          {/* Оговорка про условия — сразу за кнопкой: соглашаются с ними нажатием на неё, а не
              переходом куда-то ещё. Значок цветом основного текста: на тёмной теме это белый лист,
              то есть сам знак документа. Предупреждающий тон приберегаем для оговорок, где от
              читателя что-то требуется.

              Фраза разрезана на три ключа, потому что ссылка стоит у неё в середине: рендера
              переводов как разметки в проекте нет (см. комментарий у инстанса i18next), и вставить
              элемент внутрь одной строки нечем. Порядок частей — before, ссылка, after — держит
              обе языковые версии, поэтому пробел между ними ставит JSX, а точку после ссылки несёт
              сама строка. */}
          <AuthFooterNote icon={FileTextIcon} tone="text.primary">
            {t('auth.signup.terms.before')}{' '}
            <AuthExternalLink href={config.termsUrl}>
              {t('auth.signup.terms.link')}
            </AuthExternalLink>
            {t('auth.signup.terms.after')}
          </AuthFooterNote>
          <AuthFooterLine above="text">
            {t('auth.signup.haveAccount')}{' '}
            <AuthNavLink to="/signin">{t('auth.signup.signinLink')}</AuthNavLink>
          </AuthFooterLine>
        </>
      }
    >
      <SchemaRenderer schema={loadSchema('auth.signup')} />
    </AuthCard>
  );
}
