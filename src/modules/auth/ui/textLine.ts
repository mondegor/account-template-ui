import type { Theme } from '@mui/material';

/**
 * Высота одной строки типографики. Ею меряются соседи строки: глиф-якорь слева и действие справа —
 * оба относятся к строке и встают по центру именно её, а не по центру всего блока, который подпись
 * под строкой разгоняет вниз.
 *
 * Приём общий для заголовков профиля (`subtitle2`), карточки сессии (`subtitle1`) и строк со знаком
 * (`body2`), поэтому и формула одна: разъехавшись, они дали бы разную посадку глифа на соседних
 * экранах.
 */
export const textLine = (variant: 'subtitle1' | 'subtitle2' | 'body2') => (theme: Theme) =>
  `calc(${theme.typography[variant].fontSize} * ${theme.typography[variant].lineHeight})`;
