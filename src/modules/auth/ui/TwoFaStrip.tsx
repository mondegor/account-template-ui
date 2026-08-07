import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';
import {
  AlertCircleIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
  ShieldDotsIcon,
  ShieldOffIcon,
} from './icons';
import type { UserAuth2fa } from '../api/types';

/** Ступень лестницы защиты: тон и щит. Тон семантический, свои цвета компонент не заводит. */
const LADDER: Record<
  UserAuth2fa,
  { tone: 'primary' | 'warning' | 'success'; Shield: typeof ShieldOffIcon }
> = {
  // Выключенная 2FA — незанятая ступень, а не поломка: тон нейтральный, брендовый. `info` тут не
  // подходит — в MUI он голубой и с синим темы не совпадает.
  NONE: { tone: 'primary', Shield: ShieldOffIcon },
  PASSWORD: { tone: 'warning', Shield: ShieldDotsIcon },
  TOTP: { tone: 'success', Shield: ShieldCheckIcon },
};

/** Остаток, на котором предупреждение становится красным: «запасного выхода почти нет». */
const CODES_ALARM = 1;
/** Остаток, ниже которого предупреждение вообще появляется; выше — строки нет. */
const CODES_LOW = 4;

/**
 * Остаток аварийных кодов — не показатель, а предупреждение, поэтому пока запаса хватает, на
 * профиле его нет вовсе. Отсутствие поля значит «показывать нечего» (2FA выключена), а не ноль.
 *
 * Крайние остатки названы своими словами, `recoveryCodesLow` со счётчиком достаётся ровно
 * диапазону CODES_ALARM+1..CODES_LOW-1 — на нём и держится набор форм множественного числа в
 * словарях. Раздвинув границы, добавьте недостающие формы.
 */
function codesWarning(left: number | undefined, text: (key: string, count: number) => string) {
  if (left === undefined || left >= CODES_LOW) return null;
  if (left === 0) return { color: 'error.main', label: text('recoveryCodesEmpty', left) };
  if (left <= CODES_ALARM) return { color: 'error.main', label: text('recoveryCodesLast', left) };
  return { color: 'warning.main', label: text('recoveryCodesLow', left) };
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
  const { tone, Shield } = LADDER[type];
  const warning = codesWarning(recoveryCodesLeft, (key, count) => p(key, { count }));
  const done = type === 'TOTP';

  return (
    <ButtonBase
      component={RouterLink}
      to="/settings"
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
            sx={{ alignItems: 'center', mt: 0.25, color: warning.color }}
          >
            <AlertCircleIcon size={13} />
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
