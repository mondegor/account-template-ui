import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Link, Stack, Typography } from '@mui/material';
import { MONO_FONT, UiBusyIcon } from '@ui';
import { apiErrorText } from '@core/api';
import { moduleQueryKey } from '@core/module-registry';
import { getUserInfo, startRecoveryCodesReissue } from '../api/authApi';
import {
  areRecoveryCodesReissued,
  clearRecoveryCodes,
  getRecoveryCodes,
} from '../lib/recoveryCodes';
import { useStartSecurityFlow } from '../hooks/useStartSecurityFlow';
import { SecurityPage } from '../ui/SecurityPage';
import { CheckIcon, CopyIcon, DownloadIcon, LifeBuoyIcon } from '../ui/icons';

/**
 * Единственный показ аварийных кодов — общий хвост установки пароля и перевыпуска набора: оба
 * потока кончаются ответом `recovery_codes`, и повторно сервер их не отдаёт.
 *
 * Список живёт в памяти вкладки и не персистится, поэтому предупреждение стоит НАД ним: оно про то,
 * что случится при уходе со страницы, и прочитать его нужно до ухода, а не после.
 *
 * Закрытый показ предлагает перевыпуск, но перевыпуск бывает только при включённой защите: по спеке
 * его инициатор отвечает 409, пока второго фактора нет. Поэтому в этой ветке спрашиваем профиль —
 * кнопка, которой отказано заранее, звала бы в тупик.
 */

/** Имя файла со скачанным набором. */
const FILE_NAME = 'recovery-codes.txt';

export function RecoveryCodesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const reissue = useStartSecurityFlow();
  const p = (key: string) => t(`auth.codes.${key}`);

  // Коды перечитываются на каждом рендере: гасит их кнопка «Я сохранил коды», и своя копия в
  // состоянии пережила бы это гашение.
  const codes = getRecoveryCodes();
  // Перевыпуск отличается от выдачи только заголовком: набор заменён, старые коды уже не работают.
  const reissued = areRecoveryCodesReissued();

  // Профиль нужен только закрытому показу — при живом наборе состояние защиты известно и так:
  // набор на руках бывает лишь у включённой.
  const user = useQuery({
    queryKey: moduleQueryKey('auth', 'user'),
    queryFn: getUserInfo,
    enabled: !codes,
  });
  const twoFaOn = user.data ? user.data.auth_2fa_type !== 'NONE' : undefined;

  /** Набор вынесен из вкладки хотя бы раз — только после этого его можно гасить. */
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  /** Отказ буфера или скачивания: без строки ворота главной кнопки не открылись бы молча. */
  const [failure, setFailure] = useState<string>();

  const text = codes?.join('\n') ?? '';

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setSaved(true);
      setFailure(undefined);
    } catch {
      // Запись в буфер доступна не всегда — нужен защищённый контекст и разрешение браузера.
      // Галочка при этом снимается: удачным было прошлое копирование, а не это.
      setCopied(false);
      setFailure(p('copyFailed'));
    }
  }

  function download() {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = FILE_NAME;
      // Ссылка обязана побывать в документе: оторванную часть браузеров не нажимает, и скачивание
      // не случилось бы молча — отказ у него не бросается, а ворота главной кнопки уже открыты.
      document.body.append(link);
      link.click();
      link.remove();
      // Адрес держится до следующего кадра: блоб браузер читает уже после клика, и освобождённый
      // тут же он гонялся бы с этим чтением.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setSaved(true);
      setFailure(undefined);
    } catch {
      setFailure(p('downloadFailed'));
    }
  }

  function done() {
    clearRecoveryCodes();
    navigate('/settings', { replace: true });
  }

  return (
    <SecurityPage icon={<LifeBuoyIcon size={22} />} title={p('title')} wide>
      {codes ? (
        <>
          <Alert severity="warning" sx={{ mb: 2 }}>
            {p('warning')}
          </Alert>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            {p(reissued ? 'leadReissued' : 'lead')}
          </Typography>
          {/* Две колонки, строка на код, без нумерации: коды не порядковые, и номер рядом читался бы
              как часть кода. Моноширинный шрифт обязателен — коды переписывают руками, а на
              пропорциональном 0/O и 1/I сближаются. */}
          <Box
            data-testid="recovery-codes"
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.default',
              py: 1,
              mb: 2,
            }}
          >
            {codes.map((code, i) => (
              <Box
                key={code}
                sx={{
                  // Горизонтальный отступ ячейки вынесен в margin: рамка идёт по краю margin-box,
                  // поэтому линия начинается под первым знаком кода и обрывается, не дойдя до
                  // границы колонок, — она принадлежит своей колонке, а не всей плашке.
                  mx: 1.5,
                  py: 1,
                  fontFamily: MONO_FONT,
                  fontSize: 15,
                  // Междустрочие второстепенного текста: кегль кода крупнее ради разборчивости, а
                  // ряды при своём междустрочии держались бы разреженнее остального экрана.
                  lineHeight: (theme) => theme.typography.body2.lineHeight,
                  letterSpacing: '0.04em',
                  // Линия отбивает строку от строки; в одну колонку зрительная строка совпадает с
                  // соседом по разметке, и линия возвращается к каждому ряду, кроме первого.
                  // Толщина идёт отдельным свойством: сокращённая запись `borderTop` несёт с собой
                  // и цвет, и на брейкпоинте перебила бы цвет рамки текущим цветом текста.
                  borderTopStyle: 'solid',
                  borderTopColor: 'divider',
                  borderTopWidth: { xs: i === 0 ? 0 : 1, sm: i < 2 ? 0 : 1 },
                }}
              >
                {code}
              </Box>
            ))}
          </Box>
          {failure && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {failure}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
            <Button
              variant="outlined"
              startIcon={copied ? <CheckIcon size={18} /> : <CopyIcon size={18} />}
              onClick={() => void copy()}
            >
              {p(copied ? 'copied' : 'copy')}
            </Button>
            <Button variant="outlined" startIcon={<DownloadIcon size={18} />} onClick={download}>
              {p('download')}
            </Button>
            {/* Главная кнопка гасит список навсегда, поэтому включается только после того, как коды
                вынесли из вкладки: нажать её вслепую — остаться без запасного входа. */}
            <Button
              variant="contained"
              disabled={!saved}
              onClick={done}
              sx={{ ml: { sm: 'auto' } }}
            >
              {p('done')}
            </Button>
          </Stack>
          {!saved && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {p('doneHint')}
            </Typography>
          )}
        </>
      ) : (
        // Показ уже закрыт: список жил в памяти вкладки и не пережил перезагрузку. Без этой ветки
        // человек застал бы пустой экран и решил, что всё сломалось.
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            {p('goneOnce')}
          </Typography>
          {/* Профиль не пришёл — выхода отсюда не назвать: сказать «перевыпустите» или «включите
              защиту» одинаково нечем. Остаётся отказ, а с ним и повод перезагрузить страницу. */}
          {user.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {apiErrorText(user.error, t)}
            </Alert>
          )}
          {twoFaOn === false && (
            <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
              {p('goneNo2fa')}{' '}
              <Link component={RouterLink} to="/settings">
                {p('goneSettingsLink')}
              </Link>
            </Typography>
          )}
          {twoFaOn && (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
                {p('goneReissue')}
              </Typography>
              {reissue.error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {apiErrorText(reissue.error, t)}
                </Alert>
              )}
              <Button
                variant="contained"
                disabled={reissue.isPending}
                startIcon={reissue.isPending ? <UiBusyIcon /> : undefined}
                onClick={() =>
                  reissue.mutate({ kind: 'recovery-codes', start: startRecoveryCodesReissue })
                }
              >
                {p('reissue')}
              </Button>
            </>
          )}
        </>
      )}
    </SecurityPage>
  );
}
