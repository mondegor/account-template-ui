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
 *
 * Места под себя строка не резервирует, а раскрывается и схлопывается плавно — иначе всё, что под
 * полем, дёргалось бы на минимальной длине. Пока идёт схлопывание, узел ещё на экране, а значение
 * уже короткое: рисуется последняя показанная строка — опустошать узел нельзя, сворачивать было бы
 * нечего.
 */
export function StrengthMeter({
  state,
  onRetry,
}: {
  state: PasswordStrengthState;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const p = (key: string, opts?: Record<string, unknown>) => t(`auth.password.${key}`, opts ?? {});
  // Последняя показанная строка — та, что и схлопывается.
  const shown = useRef<ReactNode>(null);

  const rated = state.kind === 'rated' ? state.strength : null;
  const filled = rated ? strengthBars(rated) : 0;
  const tone = rated ? strengthTone(rated) : 'none';

  const line =
    state.kind === 'short' ? null : state.kind === 'checking' ? (
      <Caption text={p('checking')} />
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
          variant="caption"
          sx={{ color: tone === 'none' ? 'text.secondary' : `${tone}.main` }}
        >
          {rated ? p(`strength.${rated}`) : p('unknown')}
        </Typography>
        {/* Повтор нужен только там, где спрашивать было у чего: оценку не получили, а форма без неё
            не пропускает. */}
        {state.kind === 'failed' && (
          <IconButton type="button" size="small" aria-label={p('retry')} onClick={onRetry}>
            <RefreshIcon size={17} />
          </IconButton>
        )}
      </Stack>
    );

  if (line) shown.current = line;

  return (
    <Collapse in={Boolean(line)} unmountOnExit>
      {shown.current}
    </Collapse>
  );
}

/** Строка без шкалы: ожидание ответа заполнять нечем. */
function Caption({ text }: { text: string }) {
  return (
    <Typography
      variant="caption"
      sx={{ display: 'block', color: 'text.secondary', mt: 0.75, minHeight: 20 }}
    >
      {text}
    </Typography>
  );
}
