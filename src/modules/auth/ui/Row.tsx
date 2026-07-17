import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/** Ширина слота иконки строки — равна глифу заголовка карточки (CardHeading, 18px): строчные
 *  иконки мельче, но центрируются в этом слоте, чтобы их ось совпала с синей иконкой заголовка. */
const ROW_ICON_SLOT = 18;

/** Оптический сдвиг вниз: по центру строки иконка геометрически ровна, но линейный глиф читается
 *  чуть выше строчного текста — компенсируем на пиксель-два. */
const ROW_ICON_NUDGE = '2px';

/**
 * Строка «ключ слева — значение справа» в карточках профиля и сессий. Необязательная иконка —
 * якорь слева от подписи (цвет text.primary: в тёмной теме белая, в светлой инвертируется сама).
 * Иконка, подпись и значение — прямые потомки одного Stack, значение прижато вправо через ml:auto:
 * строковое значение остаётся последним <p> строки (на этом держатся хелперы в тестах);
 * значение-узел (чип и т.п.) рендерится как есть. `title` работает в обеих ветках — для узла
 * он висит на обёртке.
 *
 * Конвенция «нет данных → прочерк» живёт здесь, а не в вызывающих: пустая строка и
 * undefined/null дают «—» — иначе каждая точка вызова дублировала бы `|| '—'`, а забытая
 * (бэк прислал location: '') оставляла бы ячейку пустой.
 */
export function Row({
  label,
  value,
  title,
  icon,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  icon?: ReactNode;
}) {
  return (
    <Stack direction="row" alignItems="center" sx={{ py: 0.75, gap: 1 }}>
      {icon && (
        <Box
          sx={{
            color: 'text.primary',
            display: 'flex',
            justifyContent: 'center',
            flexShrink: 0,
            width: ROW_ICON_SLOT,
            mt: ROW_ICON_NUDGE,
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {typeof value === 'string' || value == null ? (
        <Typography
          variant="body2"
          title={title}
          sx={{ ml: 'auto', pl: 2, overflowWrap: 'anywhere', textAlign: 'right' }}
        >
          {value || '—'}
        </Typography>
      ) : (
        <Box title={title} sx={{ ml: 'auto', pl: 2 }}>
          {value}
        </Box>
      )}
    </Stack>
  );
}
