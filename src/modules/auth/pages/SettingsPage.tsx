import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { AppShell, LangFlag } from '@core/shell';
import { ApiFieldError } from '@core/api';
import {
  LANGUAGES,
  TIME_ZONES,
  findLanguage,
  findTimeZone,
  getOsTimeZone,
  resolveTimeZone,
  sameZoneBehaviour,
  timeZoneLabel,
} from '@core/i18n';
import { moduleQueryKey } from '@core/module-registry';
import { ClockIcon } from '../ui/icons';
import { changeUserSettings, getUserInfo } from '../api/authApi';
import type { ChangeUserSettingsRequest, UserInfo, UserSettings } from '../api/types';

/**
 * Настройки языка и часового пояса профиля. Это язык ПИСЕМ и серверных сообщений, а не языка
 * интерфейса: интерфейсом управляет переключатель в шелле, и сохранение его не перебивает.
 *
 * Обычная MUI-страница, а не схемный рендерер: список из 139 зон с подписями на языке интерфейса
 * в статичный `field.select` не выразить.
 */

/** Значение «подбери по моему окружению» — на сервер уходит ОТСУТСТВИЕМ поля в теле. */
const AUTO = 'auto';

interface Option {
  value: string;
  label: string;
}

/**
 * Список опций + гарантия, что текущее значение в нём есть. Бэк мог завести язык или зону,
 * которых фронт ещё не знает: без этого пункта MUI показал бы пустой селект вместо значения.
 *
 * Подпись такого пункта приходит от вызывающего, а не берётся из `current`: у зоны её умеет
 * собрать `timeZoneLabel` даже для несправочного имени (со смещением, как у остальных пунктов),
 * а у языка взять её неоткуда — там это сырая локаль. Смысл в том, чтобы значение выглядело
 * одинаково здесь и в профиле.
 *
 * Подпись — функцией, а не готовой строкой: у «Авто» подписывать нечего, и `timeZoneLabel('auto')`
 * зря гонял бы Intl через брошенный RangeError.
 */
function withCurrent(options: Option[], current: string, label: () => string): Option[] {
  if (current === AUTO || options.some((o) => o.value === current)) return options;
  return [...options, { value: current, label: label() }];
}

function SettingsForm({ user }: { user: UserInfo }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.settings.${key}`, opts ?? {});

  // Префилл — из профиля: форма правит профиль, поэтому показывает сохранённое. «Авто» не
  // префиллим: это осознанный жест «подбери заново», а не состояние по умолчанию.
  const [lang, setLang] = useState(user.lang);
  const [tz, setTz] = useState(user.tz);

  // Профиль в кэше обновился (фоновый рефетч того же ключа, наш же onSuccess) — селекты идут
  // за ним. Сравнением с прошлым значением, а не через key на форме: перемонтирование сбросило бы
  // состояние мутации, а с ним и плашку сохранения. Правку пользователя это не трогает: пока
  // сервер отдаёт то же самое, ветка не срабатывает.
  const [seen, setSeen] = useState({ lang: user.lang, tz: user.tz });
  if (seen.lang !== user.lang || seen.tz !== user.tz) {
    setSeen({ lang: user.lang, tz: user.tz });
    setLang(user.lang);
    setTz(user.tz);
  }

  // Опции достраиваются под ВЫБРАННОЕ значение, а не под значение профиля: после сохранения
  // селект встаёт на то, что вернул сервер, и это может быть зона вне справочника — тогда её
  // пункта в списке ещё нет, и MUI на один рендер показал бы пустой селект.
  const langOptions = useMemo(
    () =>
      withCurrent(
        LANGUAGES.map((l) => ({ value: l.locale, label: l.name })),
        lang,
        () => lang,
      ),
    [lang],
  );

  // Подписи — как в системном списке: «(UTC+03:00) Москва, Санкт-Петербург», на языке интерфейса.
  // На сервер уходит только z.id: подпись и смещение здесь — оформление.
  const tzOptions = useMemo(
    () =>
      withCurrent(
        TIME_ZONES.map((z) => ({ value: z.id, label: timeZoneLabel(z.id, i18n.language) })),
        tz,
        () => timeZoneLabel(tz, i18n.language),
      ),
    [tz, i18n.language],
  );

  // Зона ОС может отсутствовать в справочнике приложения (Asia/Novosibirsk). Пунктом её не даём:
  // явное значение проверяется строго, и выбор такого пункта вернул бы 400. Показываем подсказкой —
  // подобрать ближайшую умеет «Авто» (по заголовку X-Accept-Time-Zone).
  const osZone = getOsTimeZone();
  const osZoneUnknown = !findTimeZone(osZone);

  /**
   * Подменённая зона. Отдельное состояние, а не производная от `save.data`, по одной причине:
   * сравнение зон зовёт Intl, и считать его стоит однажды в `onSuccess`, а не на каждый рендер.
   * По времени жизни оно ничем не отличается от остального состояния мутации — гаснет вместе
   * с ним (forgetLastSave).
   */
  const [substituted, setSubstituted] = useState<string>();

  const save = useMutation({
    mutationFn: (body: ChangeUserSettingsRequest) => changeUserSettings(body),
    onMutate: () => setSubstituted(undefined),
    onSuccess: (saved: UserSettings, sent: ChangeUserSettingsRequest) => {
      // Показываем сохранённое: в режиме «Авто» сервер вернул подобранное значение, и селект
      // обязан встать на него — «Авто» это разовый жест, а не состояние формы.
      setLang(saved.lang);
      setTz(saved.tz);
      // Патчим кэш, а не инвалидируем: в ответе уже лежит всё, что вернул бы GET /v1/user.
      queryClient.setQueryData<UserInfo>(moduleQueryKey('auth', 'user'), (prev) =>
        prev ? { ...prev, lang: saved.lang, tz: saved.tz } : prev,
      );

      // Предупреждаем о подмене только про режим «Авто»: подбирает там сервер, и подбирает
      // по заголовку X-Accept-Time-Zone, то есть по зоне ОС. С ней и сравниваем. Явно выбранное
      // значение сервер проверяет строго — вернётся либо ровно оно, либо 400 по полю, подменять
      // ему там нечего, поэтому и ветки такой нет.
      //
      // Тревожим, только когда часы реально расходятся: совпало поведение — для пользователя
      // ничего не изменилось.
      //
      // Имя из ответа прогоняем через resolveTimeZone, а не суём в сравнение как есть: сравнение
      // зовёт Intl, а тот кидает RangeError на имени, которого не знает ICU браузера (его база
      // отстаёт от серверной на годы). Без проверки успешное сохранение роняло бы всю форму.
      // Зону, неизвестную ICU, считаем поводом предупредить: сверить поведение нечем, а знать,
      // что сохранилось не запрошенное, пользователю нужно.
      const savedZone = resolveTimeZone(saved.tz);
      setSubstituted(
        !sent.tz && !(savedZone && sameZoneBehaviour(osZone, savedZone)) ? saved.tz : undefined,
      );
    },
  });

  /**
   * Всё, что относится к ПРОШЛОМУ сохранению, снимается вместе, как только пользователь начал
   * править форму: подтверждение, предупреждение о подменённой зоне и подсветка 400 по полю.
   * Все три — про запрос, которого выбранные сейчас значения уже не касаются; оставить на экране
   * одно из них значило бы рассказывать про сервер на фоне формы, которая говорит другое.
   */
  const forgetLastSave = () => {
    save.reset();
    setSubstituted(undefined);
  };

  const submit = () => {
    save.mutate({
      ...(lang === AUTO ? {} : { lang }),
      ...(tz === AUTO ? {} : { tz }),
    });
  };

  // 400 приходит по полю (ApiFieldError) — подсвечиваем нужный селект, остальное показываем общим
  // сообщением. В режиме «Авто» такой ошибки не бывает: там значение подбирает сервер.
  const fieldError = (code: string) =>
    save.error instanceof ApiFieldError
      ? save.error.fields.find((f) => f.code === code)?.detail
      : undefined;
  const otherError =
    save.error && !(save.error instanceof ApiFieldError) ? save.error.message : undefined;

  return (
    <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto' }}>
      <Typography variant="h5" sx={{ fontWeight: 600 }}>
        {p('title')}
      </Typography>
      {/* Подтверждение сохранения, а не отражение состояния сервера: показываем всегда после
          успешного save. Живёт в состоянии мутации, поэтому уходит само при следующем заходе
          на страницу — отдельного «закрыть» и отдельного признака с сервера для этого не нужно.
          Единственное место, где сказано про окно применения: постоянной справки под кнопкой нет,
          потому что оговорка нужна ровно в момент сохранения. Отсюда и часы вместо галочки —
          сохранение удалось (severity success), но с нюансом по времени. */}
      {save.isSuccess && (
        <Alert
          severity="success"
          icon={<ClockIcon size={20} />}
          // MUI держит иконку у ВЕРХА сообщения (`.MuiAlert-icon` — flex с padding 7px 0), и на
          // двухстрочном тексте она заметно повисает над первой строкой. Выравниваем по этой
          // строке: коробке иконки задаём ровно её высоту — отступы сообщения (8px сверху и
          // снизу) плюс сама строка (line-height body2, типографики самого Alert), — а иконку
          // внутри ставим по центру. Свой padding при этом обнуляем, иначе он сместил бы центр.
          // `mt` — оптическая поправка на глаз поверх геометрии: у строки визуальный центр чуть
          // выше середины line-box (снизу висит место под выносные элементы букв).
          sx={{
            '& .MuiAlert-icon': {
              alignItems: 'center',
              py: 0,
              height: 'calc(16px + 1.43em)',
              mt: '-1px',
            },
          }}
        >
          {p('saved')}
        </Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2.5}>
            <FormControl fullWidth size="small" error={Boolean(fieldError('lang'))}>
              <InputLabel id="settings-lang-label">{p('lang')}</InputLabel>
              <Select
                labelId="settings-lang-label"
                label={p('lang')}
                value={lang}
                onChange={(e) => {
                  setLang(e.target.value);
                  forgetLastSave();
                }}
              >
                <MenuItem value={AUTO}>{p('auto')}</MenuItem>
                {langOptions.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: 'center',
                      }}
                    >
                      <LangFlag lang={findLanguage(o.value)?.code ?? ''} />
                      <span>{o.label}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{fieldError('lang') ?? p('langHint')}</FormHelperText>
            </FormControl>

            <FormControl fullWidth size="small" error={Boolean(fieldError('tz'))}>
              <InputLabel id="settings-tz-label">{p('tz')}</InputLabel>
              <Select
                labelId="settings-tz-label"
                label={p('tz')}
                value={tz}
                onChange={(e) => {
                  setTz(e.target.value);
                  forgetLastSave();
                }}
              >
                <MenuItem value={AUTO}>{p('auto')}</MenuItem>
                {tzOptions.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                {fieldError('tz') ?? (osZoneUnknown ? p('osZoneHint', { zone: osZone }) : ' ')}
              </FormHelperText>
            </FormControl>

            {otherError && (
              <Alert severity="error">{p('saveError', { message: otherError })}</Alert>
            )}
            {substituted && (
              <Alert severity="warning">{p('substituted', { zone: substituted })}</Alert>
            )}

            <Button
              variant="contained"
              size="large"
              disabled={save.isPending}
              onClick={submit}
              startIcon={
                save.isPending ? <CircularProgress size={20} color="inherit" /> : undefined
              }
            >
              {p('save')}
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

export function SettingsPage() {
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
        <Alert severity="error" sx={{ maxWidth: 640, mx: 'auto' }}>
          {t('auth.settings.loadError', { message: (error as Error).message })}
        </Alert>
      )}
      {/* Без key: перемонтирование на смене профиля сбрасывало бы и плашку сохранения, и
          предупреждение о подменённой зоне — а показывать их надо как раз после сохранения.
          Новые значения профиля форма подхватывает сама, сравнением с прошлым (см. SettingsForm). */}
      {data && <SettingsForm user={data} />}
    </AppShell>
  );
}
