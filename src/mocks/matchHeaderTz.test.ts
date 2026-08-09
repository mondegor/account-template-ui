import { describe, expect, it } from 'vitest';
import { buildTimeZoneHeader, sameZoneBehaviour } from '@core/i18n';
import { matchHeaderTz } from './serverTime';

/**
 * Подбор зоны по заголовку X-Accept-Time-Zone — то, что делает сервер, когда имя зоны ему
 * неизвестно. Мок повторяет серверный алгоритм подбора: индекс строится по СОСТОЯНИЯМ зон
 * (смещение + летнее время действует сейчас), поэтому у зоны с переходом в индексе две записи,
 * а при коллизии побеждает зона, встреченная в списке позже.
 *
 * Проверяем главное свойство: подобранная зона должна ВЕСТИ СЕБЯ так же, как исходная — совпадать
 * и зимой, и летом, иначе пользователь полгода видит время с ошибкой на час.
 *
 * Зоны для подбора берём заведомо ОТСУТСТВУЮЩИЕ в списке приложения: список полный
 * (139 зон, копия серверного), и знакомое имя вернулось бы как есть, ничего не проверяя.
 */
const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

describe('matchHeaderTz', () => {
  it('a known name is taken as is, without matching', () => {
    expect(matchHeaderTz(buildTimeZoneHeader('Europe/Istanbul', JUL))).toBe('Europe/Istanbul');
  });

  it.each([
    // Зона без перехода узнаётся в любое время года: её состояние единственное.
    ['Asia/Qatar', JAN],
    ['Asia/Qatar', JUL],
    // Зона с переходом — летом: dst=1 отсекает варианты без перехода.
    ['Europe/Vienna', JUL],
    ['America/Edmonton', JUL],
  ])('%s: the matched zone behaves the same way', (zone, at) => {
    const picked = matchHeaderTz(buildTimeZoneHeader(zone, at))!;
    expect(picked, 'nothing matched').toBeTruthy();
    expect(sameZoneBehaviour(zone, picked), `${zone} → ${picked}`).toBe(true);
  });

  it('in winter a DST zone is indistinguishable from a non-DST one: a limit of the method, not a defect', () => {
    // Вена в январе шлёт (+01:00, dst=0) — ровно то же, что зона вообще без перехода. В заголовке
    // один замер, у бэка данных столько же, и он ведёт себя так же. Летом (кейс выше) подбор точен.
    const picked = matchHeaderTz(buildTimeZoneHeader('Europe/Vienna', JAN))!;
    expect(picked).toBeTruthy();
    expect(sameZoneBehaviour('Europe/Vienna', picked)).toBe(false);
  });

  it('UTC takes (+00:00, dst=0): it is registered after the whole list, as on the server side', () => {
    expect(matchHeaderTz('Foo/Bar;offset=+00:00;dst=0')).toBe('UTC');
  });

  it('an offset without dst is not accepted: matching would otherwise pick a zone at random', () => {
    // То же правило в ParseAcceptTimeZone: смещение годно, только когда годны ОБА параметра.
    expect(matchHeaderTz('Foo/Bar;offset=+03:00')).toBeUndefined();
    expect(matchHeaderTz('Foo/Bar;dst=1')).toBeUndefined();
  });

  it('garbage in the header matches nothing', () => {
    expect(matchHeaderTz('Foo/Bar;offset=abc;dst=0')).toBeUndefined();
    expect(matchHeaderTz(null)).toBeUndefined();
  });
});
