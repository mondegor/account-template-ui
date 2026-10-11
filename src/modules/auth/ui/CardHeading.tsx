import type { ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { textLine } from './textLine';

/**
 * Заголовок карточки: глиф-якорь слева, справа — необязательное действие (ссылка «Сессии»).
 * Цвет держим на обёртке иконки, а не на Stack: Glyph рисует stroke="currentColor", и общий color
 * перекрасил бы заодно подпись, которая должна остаться text.primary.
 *
 * `caption` — мелкая строка под названием (признак текущего кабинета). Ради неё название и подпись
 * лежат в общей колонке, а глиф и действие ростом со строку названия (textLine).
 */
export function CardHeading({
  icon,
  title,
  caption,
  action,
  mb = 1,
}: {
  icon: ReactNode;
  title: string;
  caption?: ReactNode;
  action?: ReactNode;
  mb?: number;
}) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        mb,
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: 'flex-start',
          minWidth: 0,
        }}
      >
        <Box
          sx={{
            color: 'primary.main',
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            height: textLine('subtitle1'),
          }}
        >
          {icon}
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {/* Подпись — своей строкой с мелкой типографикой: иначе строку разгоняет межстрочный
              интервал колонки, и она отходит от названия дальше, чем на карточке сессии. */}
          {caption && (
            <Typography variant="caption" component="div">
              {caption}
            </Typography>
          )}
        </Box>
      </Stack>
      {action && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexShrink: 0,
            height: textLine('subtitle1'),
          }}
        >
          {action}
        </Box>
      )}
    </Stack>
  );
}
