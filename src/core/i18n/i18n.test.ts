import { describe, expect, it } from 'vitest';
import { addTranslations, i18next, initI18n, setLanguage } from './index';

/**
 * Сторож настройки interpolation.escapeValue: false (i18n.ts). Экранирует React, а i18next своим
 * вторым экранированием только портил данные: `/`, `&` и кавычки доезжали до экрана как `&#x2F;`.
 * Тест держит настройку на месте — вернуть `true` без падения этого теста нельзя.
 */
describe('i18n interpolation', () => {
  it('значения интерполяции не экранируются: слэши, амперсанды и кавычки как есть', () => {
    setLanguage('ru');
    initI18n();
    addTranslations({
      ru: { test: { since: 'с {{date}}', err: 'Ошибка: {{message}}' } },
      en: { test: { since: 'since {{date}}', err: 'Error: {{message}}' } },
    });

    // Английская дата — единственное место, где это вылезло наружу: en-US даёт 7/15/2026.
    expect(i18next.t('test.since', { date: '7/15/2026' })).toBe('с 7/15/2026');
    expect(i18next.t('test.err', { message: '404 /v1/user & "quoted"' })).toBe(
      'Ошибка: 404 /v1/user & "quoted"',
    );
  });
});
