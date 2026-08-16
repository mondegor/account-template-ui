import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { FORM_CARD_WIDTH, PAGE_MAX_WIDTH } from '@ui';
import { AppShell } from '@core/shell';

/**
 * Раскладка авторизованных экранов защиты аккаунта: заголовок раздела и карточка под ним. Ширина —
 * общая ширина карточки с формой, та же, что у входа и регистрации: здесь заполняют форму, а не
 * читают раздел, и колонка страницы ей широка. Один и тот же код подтверждения набирают и до
 * входа, и после него — разъехавшись, эти экраны читались бы как разные.
 *
 * Наружный заголовок называет РАЗДЕЛ и на всех экранах один: установка пароля, перевыпуск
 * аварийных кодов и отключение — всё это двухфакторная защита. Поток называет шапка карточки, и
 * глиф метит там его же — щит с точками у пароля, спаскруг у аварийных кодов. Тон у глифа
 * брендовый, как у знака секции в профиле: на цвете текста он сливался бы с заголовком рядом.
 *
 * Шапка необязательна: экран подтверждения рисует её сам — там строка заголовка делит место с
 * переключателем формата, и знать про эту пару может только он.
 */
export function SecurityPage({
  icon,
  title,
  wide,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  /**
   * Ширина колонки страниц кабинета вместо формы. Для экрана, который не заполняют, а переписывают
   * с него: аварийные коды стоят в две колонки, и в форменную ширину код целиком не встаёт.
   */
  wide?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <AppShell>
      <Stack spacing={2} sx={{ maxWidth: wide ? PAGE_MAX_WIDTH : FORM_CARD_WIDTH, mx: 'auto' }}>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {t('auth.twoFa.title')}
        </Typography>
        <Card variant="outlined">
          <CardContent>
            {title && (
              <>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                  <Box sx={{ color: 'primary.main', display: 'flex', flexShrink: 0 }}>{icon}</Box>
                  <Typography variant="h6" sx={{ fontWeight: 600 }}>
                    {title}
                  </Typography>
                </Stack>
                <Divider sx={{ mb: 1.5 }} />
              </>
            )}
            {children}
          </CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
}
