import type { ReactElement, ReactNode } from 'react';
import { Link as RouterLink } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { UiBusyIcon } from '@ui';
import { apiErrorText } from '@core/api';
import { startDisable2fa, startRecoveryCodesReissue } from '../api/authApi';
import { codesLeftLevel, codesLeftTone } from '../lib/codesLeft';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { LineGlyph } from './LineGlyph';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  LifeBuoyIcon,
  ShieldCheckIcon,
  ShieldDotsIcon,
} from './icons';
import { TWO_FA_ANCHOR } from './twoFaAnchor';
import { TWO_FA_LADDER } from './twoFaLadder';
import type { UserAuth2fa } from '../api/types';

/**
 * Двухфакторная защита на `/settings`: состояние `auth_2fa_type`, оба метода второго фактора и
 * действия над включённой защитой.
 *
 * Методы показаны всегда оба и всегда в одном порядке — перестановка ломала бы узнавание между
 * заходами. Цвет метода живёт только в щите и полоске слева: два залитых прямоугольника подряд
 * читались бы как две тревоги, а не как выбор.
 *
 * Сменить второй фактор одним шагом нельзя: инициаторы установки отвечают 409, пока 2FA включена.
 * Поэтому при включённой защите второй метод затенён, а под методами стоят подсказка и отключение.
 */

interface Method {
  /** Какой `auth_2fa_type` этот метод ставит — по нему же он и узнаёт себя включённым. */
  type: Exclude<UserAuth2fa, 'NONE'>;
  /** Ветка ключей описания метода (`auth.twoFa.method.<...>`). */
  keys: string;
  Icon: (props: { size?: number }) => ReactElement;
  /** Куда ведёт призыв. Метода без своего экрана в шаблоне не подключить — призыва у него нет. */
  route?: string;
}

const METHODS: Method[] = [
  { type: 'PASSWORD', keys: 'password', Icon: ShieldDotsIcon, route: '/security/password' },
  { type: 'TOTP', keys: 'totp', Icon: ShieldCheckIcon },
];

/** Как плитка себя ведёт: зовёт, помечена текущей либо затенена. */
type TileMode = 'open' | 'current' | 'off';

export function TwoFaCard({
  type,
  recoveryCodesLeft,
}: {
  type: UserAuth2fa;
  /** Приходит только при включённой 2FA — поля нет, когда `type` = NONE. */
  recoveryCodesLeft?: number;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.twoFa.${key}`, opts ?? {});
  // Действие тут всегда одно за раз, поэтому и отказ у перевыпуска с отключением общий: показывать
  // рядом два — значит рассказывать про попытку, которой не было.
  const flow = useStartSecurityFlow();

  const { tone, Shield } = TWO_FA_LADDER[type];
  const on = type !== 'NONE';
  // Отключение зовут двое — плитка включённого метода и кнопка внизу, — но инициатор у них один.
  const disable = () => flow.mutate({ kind: 'disable2fa', start: startDisable2fa });

  /** Метод доступен, только пока защита выключена и у него есть свой экран. */
  const mode = (method: Method): TileMode => {
    if (method.type === type) return 'current';
    return !on && method.route ? 'open' : 'off';
  };

  return (
    <Card
      variant="outlined"
      id={TWO_FA_ANCHOR}
      // Шапка приложения закреплена и накрыла бы верх карточки, к которой довели по якорю: отступ
      // прокрутки берётся с её высотой и запасом.
      sx={{ scrollMarginTop: (theme) => theme.spacing(11) }}
    >
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Box sx={{ color: `${tone}.main`, display: 'flex', flexShrink: 0 }}>
            <Shield size={22} />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>
            {p('title')}
          </Typography>
          {/* Значок состояния зелёный при любом втором факторе: он говорит «защита включена», а не
              насколько она сильна, — ступень метят щит рядом и плитки методов. */}
          <Chip
            size="small"
            color={on ? 'success' : tone}
            variant="outlined"
            label={p(on ? 'on' : 'off')}
          />
        </Stack>
        <Divider sx={{ mb: 1.5 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          {p(`lead.${type}`)}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(240px, 1fr))' },
            gap: 1.5,
          }}
        >
          {METHODS.map((method) => (
            <MethodTile
              key={method.type}
              method={method}
              mode={mode(method)}
              onDisable={disable}
              flowPending={flow.isPending}
            />
          ))}
        </Box>

        {flow.error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {apiErrorText(flow.error, t)}
          </Alert>
        )}

        {on ? (
          <Stack spacing={1.5} sx={{ mt: 1.5, alignItems: 'flex-start' }}>
            {/* Остаток приходит вместе с включённой защитой — своей ветки «поля нет» у строки
                поэтому не бывает. */}
            {recoveryCodesLeft !== undefined && (
              <CodesRow
                left={recoveryCodesLeft}
                disabled={flow.isPending}
                onReissue={() =>
                  flow.mutate({ kind: 'recovery-codes', start: startRecoveryCodesReissue })
                }
              />
            )}
            <Note icon={<AlertCircleIcon size={16} />}>{p('changeHint')}</Note>
            {/* Подвал читается сверху вниз и кончается действием там, где взгляд уже оказался. */}
            <Button
              variant="outlined"
              color="error"
              disabled={flow.isPending}
              // Знак принадлежит нажатой кнопке: отключение и перевыпуск кодов делят одну мутацию,
              // и на общем флаге он крутился бы и за перевыпуск, которого здесь не начинали.
              startIcon={
                flow.isPending && flow.variables?.kind === 'disable2fa' ? <UiBusyIcon /> : undefined
              }
              onClick={disable}
              sx={{ alignSelf: { sm: 'flex-end' }, width: { xs: '100%', sm: 'auto' } }}
            >
              {p('disable')}
            </Button>
          </Stack>
        ) : (
          <Box sx={{ mt: 1.5 }}>
            <Note icon={<LifeBuoyIcon size={16} />} plain>
              {p('codesPromise')}
            </Note>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Предложение метода: щит и название сверху, «как работает», плюс и минус, действие по низу справа.
 * Доступный метод зовёт на свой экран, включённый предлагает себя снять, затенённому предложить
 * нечего — и различает их одно затенение.
 *
 * Отключение здесь то же самое, что и кнопка внизу карточки, и инициатор у них общий. Дубль
 * намеренный: снять можно ровно тот метод, что показан включённым, и видно это должно быть у самого
 * метода, а не только в подвале карточки.
 *
 * Сама плитка — описание метода, а не кнопка: нажимается только ссылка внизу. Поэтому и цвет у неё
 * не тон метода: тоном плитка размечена (щит и полоска слева), а ссылка идёт брендовым, когда
 * ведёт дальше, и цветом отказа, когда снимает защиту.
 */
function MethodTile({
  method,
  mode,
  onDisable,
  flowPending,
}: {
  method: Method;
  mode: TileMode;
  /** Снять включённый метод. Плитка не в состоянии `current` его не показывает. */
  onDisable?: () => void;
  /**
   * Действие над защитой уже идёт — второе начинать нечем. Снятие метода зовут отсюда ссылкой, и
   * знака занятости у неё не бывает: спиннер посреди строки текста читается мусором. Ответ ссылки
   * на нажатие — сам переход на экран подтверждения.
   */
  flowPending?: boolean;
}) {
  const { t } = useTranslation();
  const p = (key: string) => t(`auth.twoFa.method.${method.keys}.${key}`);
  const tone = method.type === 'PASSWORD' ? 'warning' : 'success';
  const off = mode === 'off';

  // Шеврон стоит только у призыва: он значит переход, а отключение никуда не ведёт.
  const footer =
    mode === 'open' ? (
      <Link
        component={RouterLink}
        to={method.route ?? ''}
        variant="body2"
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontWeight: 600 }}
      >
        {p('cta')}
        <ChevronRightIcon size={14} />
      </Link>
    ) : mode === 'current' && onDisable ? (
      <Link
        component="button"
        type="button"
        color="error"
        variant="body2"
        disabled={flowPending}
        onClick={onDisable}
        sx={{ fontWeight: 600 }}
      >
        {t('auth.twoFa.disableShort')}
      </Link>
    ) : null;

  const body = (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {/* Затенённый метод сереет целиком: цвет метода зовёт, а звать здесь некуда. */}
        <Box sx={{ color: off ? 'text.secondary' : `${tone}.main`, display: 'flex' }}>
          <method.Icon size={22} />
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {p('name')}
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        {p('how')}
      </Typography>
      <Stack sx={{ mt: 0.5, flex: 1 }}>
        <Pro sign="+" text={p('plus')} />
        <Pro sign="−" text={p('minus')} />
      </Stack>
      {footer && (
        // Ссылка прижата к правому краю и занимает ровно свою ширину: растянутая на всю строку, она
        // обещала бы, что нажимается вся плитка.
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            mt: 1,
            pt: 1,
            borderTop: 1,
            borderColor: 'divider',
          }}
        >
          {footer}
        </Box>
      )}
    </>
  );

  // Плитку тесты ищут как элемент: её содержимое — описание метода, и поиск по нему проверял бы
  // формулировку, а не то, зовёт ли плитка куда-нибудь.
  return (
    <Box
      data-testid={`two-fa-method-${method.type}`}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        p: 1.75,
        height: '100%',
        border: 1,
        borderColor: 'divider',
        borderLeft: 3,
        borderLeftColor: off ? 'divider' : `${tone}.main`,
        borderRadius: 1,
        opacity: off ? 0.45 : 1,
      }}
    >
      {body}
    </Box>
  );
}

/** Плюс и минус метода. Знаки нейтральные — смысл в них несёт сам знак, а не цвет. */
function Pro({ sign, text }: { sign: string; text: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'baseline' }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 700, width: 10 }}>
        {sign}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>
        {text}
      </Typography>
    </Stack>
  );
}

/**
 * Строка ресурса: слева состояние набора, справа действие над ним. Одно место на карточку —
 * состояние и действие порознь читались бы как два разных повода.
 */
function CodesRow({
  left,
  disabled,
  onReissue,
}: {
  left: number;
  disabled: boolean;
  onReissue: () => void;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.twoFa.${key}`, opts ?? {});
  const level = codesLeftLevel(left);
  const tone = codesLeftTone(level);
  const alarming = tone !== 'none';

  return (
    <Stack
      direction="row"
      spacing={1}
      data-testid="two-fa-codes"
      sx={{
        alignItems: 'center',
        width: '100%',
        px: 1.5,
        py: 1.25,
        border: 1,
        borderColor: 'divider',
        borderRadius: 1,
        // Знак в спокойной строке берёт брендовый тон: он метит строку, и тем же тоном взят
        // спаскруг на экранах аварийных кодов. В тревожной он идёт цветом тревоги — там он часть
        // предупреждения, а не метка.
        color: alarming ? `${tone}.main` : 'text.secondary',
      }}
    >
      <LineGlyph color={alarming ? 'inherit' : 'primary.main'}>
        {alarming ? <AlertCircleIcon size={16} /> : <LifeBuoyIcon size={16} />}
      </LineGlyph>
      <Typography variant="body2" sx={{ flex: 1, fontWeight: alarming ? 600 : 400 }}>
        {p(`codesLeft.${level}`, { count: left })}
      </Typography>
      <Link
        component="button"
        type="button"
        variant="body2"
        disabled={disabled}
        onClick={onReissue}
      >
        {p('reissue')}
      </Link>
    </Stack>
  );
}

/**
 * Примечание с глифом: обещание аварийных кодов либо правило смены фактора. Глиф идёт цветом текста
 * карточки — примечание поясняет, а не зовёт, и своего тона ему не нужно.
 */
function Note({
  icon,
  plain,
  children,
}: {
  icon: ReactNode;
  /** Без рамки — примечание, а не блок: у выключенной защиты ему нечего обрамлять. */
  plain?: boolean;
  children: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        width: '100%',
        ...(plain ? {} : { px: 1.5, py: 1.25, border: 1, borderColor: 'divider', borderRadius: 1 }),
      }}
    >
      <LineGlyph>{icon}</LineGlyph>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {children}
      </Typography>
    </Stack>
  );
}
