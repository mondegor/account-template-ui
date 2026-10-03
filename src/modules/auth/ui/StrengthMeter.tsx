import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Collapse, IconButton, Stack, Typography } from '@mui/material';
import { STRENGTH_BARS, strengthBars, strengthTone } from '../lib/passwordStrength';
import type { PasswordStrengthState } from '../hooks/usePasswordStrength';
import { RefreshIcon } from './icons';

/**
 * Строка под полем пароля: сколько делений заполнено и как это называется словом.
 *
 * Шкала не исчезает, даже когда оценки нет: убери её совсем — и форма стояла бы заблокированной без
 * единого следа причины, а строка под полем прыгала бы туда-сюда на каждом ответе. Пока значение
 * короче минимума, шкалы нет вовсе: оценку на таком значении не спрашивают, и заполнять её нечем.
 * Исключение — символ вне набора: он отказ при любой длине, и шкала встаёт сразу, чтобы назвать
 * причину.
 *
 * Подпись строки — описание поля (`captionId` уходит в его `aria-describedby`), а сама строка стоит в
 * вежливом живом регионе: набор идёт в поле, описание при этом заново не читается, и без региона
 * оценку и отказ по набору слышал бы только тот, кто на них смотрит. Регион постоянный, как у
 * `UiFieldMessage`: объявляется вставка внутрь готового региона, а строка сама то есть, то нет.
 * Ожидание ответа скрыто от диктора: оно встаёт на каждой паузе в наборе, и объявлять его значило
 * бы перебивать человека пустой строкой — слышен только итог. Кнопка повтора стоит вне региона по
 * той же причине: объявляется итог, а не управление.
 *
 * Места под себя строка не резервирует, а раскрывается и схлопывается плавно — иначе всё, что под
 * полем, дёргалось бы на минимальной длине. Пока идёт схлопывание, узел ещё на экране, а значение
 * уже короткое: рисуется последняя показанная строка — опустошать узел нельзя, сворачивать было бы
 * нечего.
 */
export function StrengthMeter({
  state,
  onRetry,
  captionId,
}: {
  state: PasswordStrengthState;
  onRetry: () => void;
  /** id подписи — для `aria-describedby` поля. */
  captionId: string;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.password.${key}`, opts ?? {});
  // Последняя показанная строка — та, что и схлопывается.
  const shown = useRef<ReactNode>(null);

  const rating = state.kind === 'rated' ? state : null;
  const filled = rating ? strengthBars(rating.strength) : 0;
  // Символ вне набора — отказ, а не незнание: шкала пустая, но подпись красная и называет причину.
  const tone = rating
    ? strengthTone(rating.accept_status)
    : state.kind === 'badChars'
      ? 'error'
      : 'none';
  // Формат аварийного кода не лечится усилением, и красная «надёжная» ступень про него ничего бы
  // не сказала — вместо неё подпись называет саму причину. Деления остаются по ступени.
  const caption = !rating
    ? p(state.kind === 'badChars' ? 'badChars' : 'unknown')
    : rating.accept_status === 'RECOVERY_CODE_FORMAT'
      ? p('recoveryCodeFormat')
      : p(`strength.${rating.strength}`);

  const line =
    state.kind === 'short' ? null : state.kind === 'checking' ? (
      // Строка без шкалы: ожидание ответа заполнять нечем. Диктору её не объявляем — см. выше.
      <Typography
        aria-hidden
        variant="caption"
        sx={{ display: 'block', color: 'text.secondary', mt: 0.75, minHeight: 20 }}
      >
        {p('checking')}
      </Typography>
    ) : (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.75, minHeight: 20 }}>
        <Stack direction="row" spacing={0.5} sx={{ width: 92 }} data-testid="strength-bars">
          {Array.from({ length: STRENGTH_BARS }, (_, i) => (
            <Box
              key={i}
              sx={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                bgcolor:
                  i < filled && tone !== 'none' ? `${tone}.main` : 'action.disabledBackground',
              }}
            />
          ))}
        </Stack>
        <Typography
          id={captionId}
          variant="caption"
          sx={{ color: tone === 'none' ? 'text.secondary' : `${tone}.main` }}
        >
          {caption}
        </Typography>
      </Stack>
    );

  if (line) shown.current = line;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box role="status">
        <Collapse in={Boolean(line)} unmountOnExit>
          {shown.current}
        </Collapse>
      </Box>
      {/* Повтор нужен только там, где спрашивать было у чего: оценку не получили, а форма без неё
          не пропускает. Кнопка выше строки, поэтому встаёт и уходит плавно, как и сама строка:
          иначе блок под полем дёргался бы, а при схлопывании строки кнопка пропадала бы раньше
          неё. Отступ — тот же, что у строки, чтобы стоять вровень с подписью. */}
      <Collapse in={state.kind === 'failed'} unmountOnExit>
        <IconButton
          type="button"
          size="small"
          aria-label={p('retry')}
          onClick={onRetry}
          sx={{ mt: 0.75 }}
        >
          <RefreshIcon size={17} />
        </IconButton>
      </Collapse>
    </Stack>
  );
}
