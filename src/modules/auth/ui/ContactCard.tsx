import type { FormEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { UiBusyIcon, UiFieldMessage, UiTextField, uiFieldBlockSx } from '@ui';
import { CheckIcon } from './icons';

/**
 * Общие куски карточек емаила и телефона на странице настроек. Устроены карточки одинаково: в покое
 * — значение и действие над ним, в правке — текущее значение подписью сверху и поле нового под ним.
 * Само подтверждение идёт уже на экране операции.
 */

/** Карточка с шапкой — той же, что у соседних карточек настроек: глиф брендовым тоном, h6, линия. */
export function ContactCardShell({
  id,
  icon,
  title,
  chip,
  children,
}: {
  /** Якорь: на карточку ведут переходы, и её же находит прокрутка страницы. */
  id: string;
  icon: ReactNode;
  title: string;
  chip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      variant="outlined"
      id={id}
      // Шапка приложения закреплена и накрыла бы верх карточки, к которой довели по якорю.
      sx={{ scrollMarginTop: (theme) => theme.spacing(11) }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Box sx={{ color: 'primary.main', display: 'flex', flexShrink: 0 }}>{icon}</Box>
          <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>
            {title}
          </Typography>
          {chip}
        </Stack>
        <Divider sx={{ mb: 1.5 }} />
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Текст только для экранного диктора: переход рисует стрелка, а она вслух не читается. Готового
 * помощника в @ui нет, а тянуть его из внутренностей MUI значило бы опереться на зависимость,
 * которую репозиторий себе не объявлял.
 */
const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * Строка карточки в покое: значение, под ним — что оно значит, справа — действие. Пояснение нужно
 * постоянно: заголовок карточки называет предмет, а зачем он аккаунту, говорит только эта строка.
 */
export function ContactValue({
  value,
  sub,
  empty,
  next,
  action,
}: {
  value: string;
  sub: string;
  /** Значения нет — строка говорит об этом тише, чем говорила бы о самом значении. */
  empty?: boolean;
  /**
   * Значение, на которое идёт замена, пока она не применена. Стоит рядом с текущим через стрелку:
   * иначе карточка сообщает только сам факт начатого изменения, а что меняется — приходится
   * вычитывать из блока под ней. `label` — слово для экранного диктора.
   */
  next?: { value: string; label: string };
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={{ xs: 1.25, sm: 2 }}
      sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Два адреса в строку не встают, поэтому строка переносится, а перенос внутри каждого
            адреса остаётся своим: почтовый адрес — одно длинное слово. */}
        <Box
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 1, mb: 0.25 }}
        >
          <Typography
            component="span"
            sx={{
              fontSize: 16,
              // Когда значения нет, строка набрана тем же тоном, что и пояснение под ней, и
              // держится на весе и зазоре: без них «Не указан» читается первой строкой пояснения.
              fontWeight: empty ? 500 : 600,
              color: empty ? 'text.secondary' : 'text.primary',
              overflowWrap: 'anywhere',
            }}
          >
            {value}
          </Typography>
          {next && (
            <>
              <Box aria-hidden component="span" sx={{ color: 'text.disabled', flexShrink: 0 }}>
                →
              </Box>
              <Box component="span" sx={SR_ONLY}>
                {next.label}
              </Box>
              {/* Величина и вес те же — это тоже значение; тише тоном, потому что оно ещё
                  не действует. */}
              <Typography
                component="span"
                sx={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: 'text.secondary',
                  overflowWrap: 'anywhere',
                }}
              >
                {next.value}
              </Typography>
            </>
          )}
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: 13 }}>
          {sub}
        </Typography>
      </Box>
      {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
    </Stack>
  );
}

/** Кнопка действия строки: по размеру — как у соседних карточек, на узком экране во всю ширину. */
export function ContactAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="outlined" onClick={onClick} sx={{ width: { xs: '100%', sm: 'auto' } }}>
      {label}
    </Button>
  );
}

/** Плашка итога: смена прошла, и сказать об этом надо там, куда человек вернулся. */
export function ContactDone({ title }: { title: string }) {
  return (
    <Alert severity="success" icon={<CheckIcon size={20} />} sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
    </Alert>
  );
}

/**
 * Форма нового значения. «Продолжить», а не «Сохранить»: после нажатия ничего ещё не сохранено —
 * создана операция, которую предстоит подтвердить.
 *
 * Под полем две строки: отказ, если он есть, и подсказка, куда придёт код. Подсказка постоянна —
 * она нужна ровно перед нажатием, и ошибка её не вытесняет, а встаёт над ней.
 */
export function ContactForm({
  name,
  label,
  value,
  onChange,
  type,
  inputMode,
  autoComplete,
  placeholder,
  maxLength,
  hint,
  fieldError,
  formError,
  top,
  aside,
  busy,
  canSubmit,
  onCancel,
  onSubmit,
}: {
  /** Имя поля запроса — оно же основа id строк под полем. */
  name: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type: 'email' | 'tel';
  inputMode: 'email' | 'tel';
  autoComplete: string;
  placeholder: string;
  maxLength: number;
  hint: string;
  fieldError?: string;
  formError?: string;
  /** Плашки над полем — пояснения к режиму формы, а не к набранному. */
  top?: ReactNode;
  /** Второстепенное действие формы — встаёт в ряд с кнопками, слева от них. */
  aside?: ReactNode;
  busy: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit && !busy) onSubmit();
  };

  return (
    <Box component="form" onSubmit={submit} noValidate>
      {top}
      <Box sx={uiFieldBlockSx('message')}>
        <UiTextField
          name={name}
          label={label}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          disabled={busy}
          autoFocus
          error={Boolean(fieldError)}
          // Обе строки рисуются здесь же, под полем: связь с ним держим сами, в порядке экрана.
          collapseHelper
          messageBelow
          describedBy={fieldError ? `${errorId} ${hintId}` : hintId}
        />
        <UiFieldMessage id={errorId} text={fieldError} tone="error" align="start" live />
        <UiFieldMessage id={hintId} text={hint} align="start" />
      </Box>

      {formError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {formError}
        </Alert>
      )}

      {/* Действия по правому краю, как у соседних карточек, второстепенное — по левому в том же
          ряду; на узком экране — столбиком, главное сверху, второстепенное под кнопками: там правый
          край и есть вся ширина. Зазор — `gap`, а не `spacing` у Stack: тот обнуляет поля детей
          своим селектором, и `margin-right: auto`, который отжимает ссылку влево, до неё не дошёл
          бы. */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column-reverse', sm: 'row' },
          justifyContent: 'flex-end',
          alignItems: { xs: 'stretch', sm: 'center' },
          gap: 1,
          mt: 1,
        }}
      >
        {aside && (
          // Своя flex-строка, а не строчный текст: иначе ссылка садилась бы на базовую линию
          // обёртки и проседала относительно подписей кнопок. `mt` — оптическая поправка поверх
          // геометрии: подписи кнопок набраны капсом, у них нет нижних выносных, и строчная ссылка
          // по центру коробки на глаз сидит ниже них.
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              mt: { sm: '-2px' },
              mr: { sm: 'auto' },
              alignSelf: { xs: 'flex-start', sm: 'center' },
            }}
          >
            {aside}
          </Box>
        )}
        <Button type="button" disabled={busy} onClick={onCancel}>
          {t('auth.contacts.cancel')}
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={!canSubmit || busy}
          startIcon={busy ? <UiBusyIcon /> : undefined}
        >
          {t('auth.contacts.continue')}
        </Button>
      </Box>
    </Box>
  );
}
