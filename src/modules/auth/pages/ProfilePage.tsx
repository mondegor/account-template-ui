import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { AppShell, LangFlag } from '@core/shell';
import { realmProvider } from '@core/auth';
import { findLanguage, fromApiLocale, resolveTimeZone, timeZoneLabel } from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { getUserInfo } from '../api/authApi';
import { fmtDate, useLocale, useNow } from '../lib/format';
import { realmLabel, userKindLabel } from '../lib/realmLabel';
import { Row } from '../ui/Row';
import { TimeRow } from '../ui/TimeRow';
import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  GlobeIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldIcon,
  TagIcon,
  UserIcon,
} from '../ui/icons';
import type { UserInfo, UserRealm, UserStatus } from '../api/types';

const STATUS_COLOR: Record<UserStatus, 'default' | 'success' | 'warning' | 'error'> = {
  DRAFT: 'default',
  ENABLED: 'success',
  DISABLED: 'warning',
  BLOCKED: 'error',
};

/**
 * Заголовок карточки: глиф-якорь слева, справа — необязательное действие (ссылка «Сессии»).
 * Цвет держим на обёртке иконки, а не на Stack: Glyph рисует stroke="currentColor", и общий color
 * перекрасил бы заодно подпись, которая должна остаться text.primary.
 */
function CardHeading({
  icon,
  title,
  action,
  mb = 1,
}: {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  mb?: number;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: 'space-between',
        alignItems: 'center',
        mb,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'center',
        }}
      >
        <Box sx={{ color: 'primary.main', display: 'flex', flexShrink: 0 }}>{icon}</Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Stack>
      {action}
    </Stack>
  );
}

function RealmCard({
  realm,
  title,
  multiRealm,
  isCurrent,
  timeZone,
  now,
}: {
  realm: UserRealm;
  title: string;
  multiRealm: boolean;
  /** Кабинет текущей сессии — акцентная рамка, как у текущей сессии на странице сессий.
   *  Осмыслен только в мультиреалме: единственную карточку выделять не из чего. */
  isCurrent: boolean;
  /** Пояс профиля, уже проверенный на странице; undefined = рисуем в поясе браузера. */
  timeZone?: string;
  now: number;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.profile.${key}`, opts ?? {});
  const kind = userKindLabel(t, realm.user_kind);

  return (
    <Card
      variant="outlined"
      sx={isCurrent ? { borderColor: 'primary.main', borderWidth: 2 } : undefined}
    >
      <CardContent>
        <CardHeading
          icon={<BriefcaseIcon size={18} />}
          title={title}
          action={
            <Link
              component={RouterLink}
              to={`/sessions?realm=${encodeURIComponent(realm.name)}`}
              variant="body2"
              // Видимый текст «Сессии» совпадает с пунктом меню AppShell (а в мультиреалме ещё и
              // между карточками) — скринридеру одноимённые ссылки с разными href не различить.
              // Уточняем в доступном имени (видимая подпись в него входит — WCAG 2.5.3): в
              // мультиреалме — кабинет; в одиночном кабинета на экране нет, и имя нейтральное —
              // «Сессии учётной записи», без утечки сырого имени реалма.
              aria-label={multiRealm ? p('sessionsOf', { realm: title }) : p('sessionsOfAccount')}
            >
              {p('sessions')}
            </Link>
          }
        />
        <Divider />
        <Row
          label={p('accountKind')}
          value={<Chip size="small" color="secondary" label={kind} />}
          icon={<TagIcon size={12} />}
        />
        <Row
          label={p('registeredAt')}
          value={fmtDate(realm.created_at, locale, timeZone)}
          icon={<CalendarIcon size={12} />}
        />
        <Row
          label={p('lastLocation')}
          value={realm.last_location}
          icon={<MapPinIcon size={12} />}
        />
        <TimeRow
          label={p('lastLogin')}
          value={realm.last_logged_at}
          locale={locale}
          timeZone={timeZone}
          now={now}
          justNow={p('lastLoginJustNow')}
          icon={<ClockIcon size={12} />}
        />
      </CardContent>
    </Card>
  );
}

function ProfileView({ user }: { user: UserInfo }) {
  const { t, i18n } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.profile.${key}`, opts ?? {});
  // Тик «N назад» один на все карточки: иначе каждая держала бы свой setInterval.
  const now = useNow(60_000);
  // Кабинет текущей сессии — реалм деплоя: в мультиреалме подсвечиваем его карточку рамкой.
  const currentRealm = realmProvider.getRealm();
  // Инвариант деплоя: у пользователя всегда есть минимум один реалм — случая «нуль кабинетов» не
  // бывает. Поэтому один кабинет — выбирать не из чего: слова «кабинет» не вводим вовсе и блок
  // называется просто «Учётная запись». Несколько — заголовком каждого блока служит пользовательское
  // название кабинета, иначе одинаковых «Учётных записей» было бы не различить.
  const multiRealm = user.realms.length > 1;
  // Пояс профиля проверяем ОДИН раз на страницу: ниже по дереву идёт уже пригодное значение,
  // поэтому форматтеры в карточках не нужно оборачивать в try. undefined (ICU браузера зону
  // не знает) = рисуем в поясе браузера, а не роняем страницу.
  const timeZone = resolveTimeZone(user.tz);

  // Язык и пояс показываем так же, как они выглядят в форме настроек: название языка и подпись
  // зоны. Зону, которой во фронте ещё нет (бэк завёл новую), timeZoneLabel подписывает сам —
  // разбор случаев живёт там, чтобы два экрана не расходились. Язык без справочника подписать
  // нечем: выводим сырую локаль.
  const langName = findLanguage(user.lang)?.name ?? user.lang;
  const tzLabel = timeZoneLabel(user.tz, i18n.language);

  // Зону, непригодную для Intl, страница молча заменяет поясом браузера — иначе даты не показать
  // вовсе. Молчать об этом нельзя: строка утверждала бы один пояс, а даты рядом шли бы в другом.
  // Место для оговорки — подсказка этой же строки, где и так лежит техническое имя зоны.
  const tzTitle = timeZone ? user.tz : `${user.tz} — ${p('tzUnsupported')}`;

  // Расхождение языка интерфейса и языка профиля здесь НЕ поясняем: объяснение живёт у самого
  // регулятора — под селектом языка на /settings («Язык писем и сообщений сервера. Язык интерфейса
  // переключается в шапке»). В профиле это была лишняя строка.

  return (
    <Stack spacing={2} sx={{ maxWidth: 880, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('title')}
      </Typography>
      <Card variant="outlined">
        <CardContent>
          <CardHeading
            icon={<UserIcon size={18} />}
            title={p('personalInfo')}
            action={
              <Link
                component={RouterLink}
                to="/settings"
                variant="body2"
                // Видимый текст совпадает с пунктом меню AppShell — уточняем доступное имя,
                // как у ссылки «Сессии» в карточке кабинета (WCAG 2.5.3).
                aria-label={p('settingsAria')}
              >
                {p('settingsLink')}
              </Link>
            }
          />
          <Divider />
          <Row label={p('email')} value={user.email} icon={<MailIcon size={12} />} />
          <Row label={p('phone')} value={user.phone} icon={<PhoneIcon size={12} />} />
          <Row
            label={p('lang')}
            icon={<GlobeIcon size={12} />}
            // На экране — название языка, в подсказке сырая локаль: техническое значение
            // не теряем, но и не показываем им `ru-RU` вместо «Русский».
            title={user.lang}
            value={
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: 'center',
                }}
              >
                {/* Незнакомую фронту локаль показываем как есть, без флага: чужой флаг врал бы. */}
                <LangFlag lang={fromApiLocale(user.lang) ?? ''} />
                <Typography variant="body2">{langName}</Typography>
              </Stack>
            }
          />
          <Row label={p('tz')} icon={<ClockIcon size={12} />} title={tzTitle} value={tzLabel} />
        </CardContent>
      </Card>
      {user.realms.map((realm) => (
        <RealmCard
          key={realm.name}
          realm={realm}
          title={multiRealm ? realmLabel(t, realm.name) : p('account')}
          multiRealm={multiRealm}
          isCurrent={multiRealm && realm.name === currentRealm}
          timeZone={timeZone}
          now={now}
        />
      ))}
      <Card variant="outlined">
        <CardContent>
          <CardHeading icon={<ShieldIcon size={18} />} title={p('security')} mb={1.5} />
          <Stack direction="row" spacing={1}>
            <Chip size="small" label={p(`twoFa.${user.auth_2fa_type}`)} />
            <Chip size="small" color={STATUS_COLOR[user.status]} label={user.status} />
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function ProfilePage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: moduleQueryKey('auth', 'user'),
    queryFn: getUserInfo,
  });

  return (
    <AppShell>
      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
          <CircularProgress />
        </Box>
      )}
      {isError && (
        <Alert severity="error" sx={{ maxWidth: 880, mx: 'auto' }}>
          {t('auth.profile.loadError', { message: (error as Error).message })}
        </Alert>
      )}
      {data && <ProfileView user={data} />}
    </AppShell>
  );
}
