import { fireEvent, screen, within } from '@testing-library/react';

/** Общие DOM-хелперы тестов страниц на карточной вёрстке (MUI Card + Row «ключ — значение»). */

/**
 * Ряд клеток кода: значение приезжает вставкой в первую клетку — тем же путём, которым код и
 * попадает в поле в жизни. Клетки наружу — одно поле, и тест обращается с ним так же.
 */
export function fillCode(value: string, name = 'secret') {
  fireEvent.paste(screen.getByTestId(`field-${name}-0`), {
    clipboardData: { getData: () => value },
  });
}

/** Строка ряда клеток целиком — то, что уйдёт на сервер. */
export function codeValue(name = 'secret'): string {
  return within(screen.getByTestId(`field-${name}`))
    .getAllByRole('textbox')
    .map((cell) => (cell as HTMLInputElement).value)
    .join('');
}

/** Карточка, содержащая данный текст (заголовок карточки, имя устройства и т.п.). */
export function cardWith(text: string): HTMLElement {
  return screen.getByText(text).closest('.MuiCard-root') as HTMLElement;
}

/** Значение строки Row по её подписи: строковое значение — последний <p> той же строки. */
export function rowValue(label: string, scope?: HTMLElement) {
  const node = scope ? within(scope).getByText(label) : screen.getByText(label);
  return node.closest('div')?.querySelector('p:last-child');
}
