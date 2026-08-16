import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Stack, Typography } from '@mui/material';

/**
 * Презентационные атомы раскладки над MUI (плоские пропсы, без знания о схеме). Schema-aware
 * адаптеры живут в core/renderer и мапят узлы на эти атомы (направление зависимостей core → ui).
 */

/**
 * Ширина колонки страниц кабинета. Одна на все экраны: профиль, сессии, настройки и экраны защиты
 * стоят в одном разделе и переходят друг в друга, а разъехавшаяся колонка читалась бы как смена
 * раздела. Внутри карточек — строки «подпись слева, значение справа»; шире этого числа они
 * растягиваются в две далёкие друг от друга колонки, и связь между половинами теряется.
 */
export const PAGE_MAX_WIDTH = 640;

/**
 * Ширина карточки с формой: вход, регистрация, подтверждение и экраны защиты аккаунта. Форму
 * заполняют по одному полю за раз, и колонка страницы ей широка — строка подсказки над полем
 * растягивалась бы вдвое длиннее самого поля. Число одно на публичную зону и на кабинет: один и тот
 * же код подтверждения набирают и до входа, и после него, и разная ширина читалась бы как разные
 * экраны.
 */
export const FORM_CARD_WIDTH = 360;

export function UiPage({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <Box data-testid="ui-page">
      {title && (
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      )}
      {subtitle && (
        <Typography
          variant="body2"
          sx={{
            color: 'text.secondary',
            mt: 0.5,
            // На четыре пикселя меньше, чем зазор между полем и кнопкой: в строчный бокс текста
            // входит ещё около пяти пикселей собственного просвета под последней строкой, и равные
            // по числу отступы читались бы у текста крупнее.
            mb: 2,
          }}
        >
          {subtitle}
        </Typography>
      )}
      {children}
    </Box>
  );
}

/**
 * Обёртка, которая тянет свою высоту к высоте содержимого переходом. Нужна там, где текст
 * подменяется другим текстом другой высоты: без неё всё, что ниже, скачком уезжает на строку.
 *
 * `Collapse` тут не годится: он анимирует появление и исчезновение, а не изменение высоты уже
 * показанного, — подменённый текст сложился бы в ноль и раскрылся заново.
 *
 * Высоту меряет `ResizeObserver`. Где его нет (jsdom), высота не выставляется вовсе и остаётся
 * `auto`: иначе `overflow: hidden` поверх нулевого измерения спрятал бы содержимое.
 */
export function UiSmoothHeight({ children }: { children?: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeight(el.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      sx={{
        height,
        overflow: 'hidden',
        transition: (theme) => theme.transitions.create('height'),
      }}
    >
      {/* `flow-root` — чтобы измеряемая высота включала вертикальные поля содержимого: у обычного
          блока они схлопываются наружу, и замер вышел бы меньше настоящего, а `overflow: hidden`
          внешнего бокса срезал бы низ текста. */}
      <Box ref={inner} sx={{ display: 'flow-root' }}>
        {children}
      </Box>
    </Box>
  );
}

export function UiSection({ spacing = 2, children }: { spacing?: number; children?: ReactNode }) {
  return (
    <Stack spacing={spacing} data-testid="ui-section">
      {children}
    </Stack>
  );
}

/** Адаптивная сетка через CSS grid (не зависим от версии MUI Grid). cols — число или брейкпоинт-мапа. */
export function UiGrid({
  cols = 1,
  spacing = 2,
  children,
}: {
  cols?: number | Partial<Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number>>;
  spacing?: number;
  children?: ReactNode;
}) {
  const templ =
    typeof cols === 'number'
      ? `repeat(${cols}, 1fr)`
      : Object.fromEntries(Object.entries(cols).map(([bp, n]) => [bp, `repeat(${n}, 1fr)`]));
  return (
    <Box data-testid="ui-grid" sx={{ display: 'grid', gap: spacing, gridTemplateColumns: templ }}>
      {children}
    </Box>
  );
}
