import type { ReactElement } from 'react';
import { alpha, ButtonBase, Stack } from '@mui/material';

/**
 * Выбор формата секрета — две пиктограммы в строке заголовка, справа. Кольцо есть у обеих: оно
 * показывает, что знаки составляют пару, из которой выбирают; активный отличается тоном.
 *
 * Что набирают сейчас, называет сообщение под заголовком — оно меняется вместе с выбором. Знакам
 * остаётся `aria-label` для тех, кто экрана не видит, и `aria-pressed` на состояние.
 */

export interface SecretModeOption<M extends string> {
  mode: M;
  /** Доступное имя кнопки — короткое: «Ввести пароль». */
  label: string;
  Icon: (props: { size?: number }) => ReactElement;
}

export function SecretModeSwitch<M extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<SecretModeOption<M>>;
  value: M;
  onChange: (mode: M) => void;
}) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
      {options.map(({ mode, label, Icon }) => {
        const active = mode === value;
        return (
          <ButtonBase
            key={mode}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(mode)}
            sx={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 1,
              borderColor: active ? 'primary.main' : 'divider',
              bgcolor: active ? (theme) => alpha(theme.palette.primary.main, 0.12) : 'transparent',
              color: active ? 'primary.main' : 'text.secondary',
              '&:hover': active ? undefined : { color: 'text.primary', bgcolor: 'action.hover' },
            }}
          >
            <Icon size={17} />
          </ButtonBase>
        );
      })}
    </Stack>
  );
}
