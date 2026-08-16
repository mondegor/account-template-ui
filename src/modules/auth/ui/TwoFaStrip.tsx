import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import { AlertCircleIcon, ChevronRightIcon } from './icons';
import { LineGlyph } from './LineGlyph';
import { TWO_FA_HREF } from './twoFaAnchor';
import { TWO_FA_LADDER } from './twoFaLadder';
import { codesLeftLevel, codesLeftTone } from '../lib/codesLeft';
import type { UserAuth2fa } from '../api/types';

/** Подпись ступени. `enough` своей строки не имеет: пока запаса хватает, предупреждать не о чем. */
const CODES_LABEL = {
  empty: 'recoveryCodesEmpty',
  last: 'recoveryCodesLast',
  low: 'recoveryCodesLow',
} as const;

/**
 * Остаток аварийных кодов — не показатель, а предупреждение, поэтому пока запаса хватает, на
 * профиле его нет вовсе. Отсутствие поля значит «показывать нечего» (2FA выключена), а не ноль.
 *
 * Крайние остатки названы своими словами, `recoveryCodesLow` со счётчиком достаётся ровно ступени
 * `low` — на ней и держится набор форм множественного числа в словарях. Раздвинув границы ступеней
 * (lib/codesLeft), добавьте недостающие формы.
 */
function codesWarning(left: number | undefined, text: (key: string, count: number) => string) {
  if (left === undefined) return null;
  const level = codesLeftLevel(left);
  if (level === 'enough') return null;
  return { color: `${codesLeftTone(level)}.main`, label: text(CODES_LABEL[level], left) };
}

/**
 * Подвал карточки «Личные данные»: индикатор двухфакторной защиты и он же вход в её настройку.
 * Задача полосы не сообщить состояние, а подтолкнуть — призыв справа ведёт вверх по лестнице
 * (включить → усилить) и гаснет до нейтрального, когда тянуть больше некуда.
 *
 * Тон полосы считается ТОЛЬКО из `type`: кончающиеся аварийные коды — отдельное событие, они
 * меняют строку внизу и ничего больше. Защита цела, кончается запасной выход.
 *
 * Доступное имя ссылки складывается из её же текста: он и называет состояние, и говорит, что
 * будет по нажатию, — aria-label только заглушил бы это одной общей фразой.
 */
export function TwoFaStrip({
  type,
  recoveryCodesLeft,
}: {
  type: UserAuth2fa;
  /** Приходит только при включённой 2FA — поля нет, когда `type` = NONE. */
  recoveryCodesLeft?: number;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.profile.${key}`, opts ?? {});
  const { tone, Shield } = TWO_FA_LADDER[type];
  const warning = codesWarning(recoveryCodesLeft, (key, count) => p(key, { count }));
  const done = type === 'TOTP';

  return (
    <ButtonBase
      component={RouterLink}
      // Целимся в саму карточку защиты: настройки открываются формой профиля, и карточка на них
      // лежит ниже — без якоря переход упирался бы в чужой экран.
      to={TWO_FA_HREF}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.75,
        width: '100%',
        px: 2,
        py: 1.75,
        textAlign: 'left',
        borderTop: 1,
        borderColor: 'divider',
        // Скругление снизу берёт на себя сама карточка: у MUI Card `overflow: hidden`.
        bgcolor: (theme) => alpha(theme.palette[tone].main, 0.1),
        '&:hover': { bgcolor: (theme) => alpha(theme.palette[tone].main, 0.16) },
        // Акцентная полоска слева — тот же тон, что и заливка, только в полную силу.
        '&::before': {
          content: '""',
          position: 'absolute',
          insetBlock: 0,
          left: 0,
          width: 3,
          bgcolor: `${tone}.main`,
        },
      }}
    >
      <Box sx={{ color: `${tone}.main`, display: 'flex', flexShrink: 0 }}>
        <Shield size={30} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {p(`twoFa.${type}.title`)}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {p(`twoFa.${type}.hint`)}
        </Typography>
        {warning && (
          <Stack
            direction="row"
            spacing={0.75}
            // Тест «предупреждения нет» иначе искал бы отсутствие текста регуляркой по подписи —
            // то есть проверял бы формулировку, а не наличие строки.
            data-testid="two-fa-codes-warning"
            sx={{ mt: 0.25, color: warning.color }}
          >
            <LineGlyph>
              <AlertCircleIcon size={13} />
            </LineGlyph>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {warning.label}
            </Typography>
          </Stack>
        )}
      </Box>
      {/* На верхней ступени звать некуда: призыв гаснет до нейтрального «настроить». */}
      <Stack
        direction="row"
        spacing={0.75}
        sx={{
          ml: 'auto',
          pl: 2,
          alignItems: 'center',
          flexShrink: 0,
          color: done ? 'text.secondary' : `${tone}.main`,
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: done ? 500 : 600 }}>
          {p(`twoFa.${type}.cta`)}
        </Typography>
        <ChevronRightIcon size={14} />
      </Stack>
    </ButtonBase>
  );
}
