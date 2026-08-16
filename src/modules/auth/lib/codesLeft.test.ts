import { beforeAll, describe, expect, it } from 'vitest';
import { LANGUAGES, addTranslations, i18next, initI18n } from '@core/i18n';
import { authTranslations } from '../i18n';
import { codesLeftLevel, codesLeftTone } from './codesLeft';

/**
 * Границы ступеней. Они держат набор форм множественного числа в словарях и решают, с какого
 * остатка экран тревожится, — раздвинув их, придётся править и подписи.
 */

describe('recovery codes left', () => {
  it.each([
    [0, 'empty'],
    [1, 'last'],
    [2, 'low'],
    [3, 'low'],
    [4, 'enough'],
    [10, 'enough'],
  ] as const)('reads %i codes as %s', (left, level) => {
    expect(codesLeftLevel(left)).toBe(level);
  });

  /** Тон говорит про запасной выход: его почти нет, он кончается, либо запаса хватает. */
  it.each([
    ['empty', 'error'],
    ['last', 'error'],
    ['low', 'warning'],
    ['enough', 'none'],
  ] as const)('colours %s as %s', (level, tone) => {
    expect(codesLeftTone(level)).toBe(tone);
  });

  /**
   * Ступень должна быть сказуема на каждом языке и на любом остатке: недостающую форму множественного
   * числа i18next отдаёт самим ключом, и он же встаёт на экран. Верхней границы у `enough` нет,
   * поэтому её формы обязаны покрывать все категории числа, а не только ближние остатки.
   */
  describe('says every step in every language', () => {
    beforeAll(() => {
      initI18n();
      addTranslations(authTranslations);
    });

    // Остатки задевают все категории Intl.PluralRules: 21 — one, 2..4 — few, 5..20 — many.
    it.each([0, 1, 2, 3, 4, 5, 11, 21, 25, 101])('has a form for %i', (left) => {
      const key = `auth.twoFa.codesLeft.${codesLeftLevel(left)}`;

      for (const { code } of LANGUAGES) {
        expect(i18next.getFixedT(code)(key, { count: left }), code).not.toBe(key);
      }
    });
  });
});
