import { screen, within } from '@testing-library/react';

/** Общие DOM-хелперы тестов страниц на карточной вёрстке (MUI Card + Row «ключ — значение»). */

/** Карточка, содержащая данный текст (заголовок карточки, имя устройства и т.п.). */
export function cardWith(text: string): HTMLElement {
  return screen.getByText(text).closest('.MuiCard-root') as HTMLElement;
}

/** Значение строки Row по её подписи: строковое значение — последний <p> той же строки. */
export function rowValue(label: string, scope?: HTMLElement) {
  const node = scope ? within(scope).getByText(label) : screen.getByText(label);
  return node.closest('div')?.querySelector('p:last-child');
}
