import { beforeEach, describe, expect, it } from 'vitest';
import { refresh, useAuthStore } from '@core/auth';
import { ApiFieldError } from '@core/api';
import { TIME_ZONES, getLanguage, getLanguageSource, initI18n, setLanguage } from '@core/i18n';
import { clearSettingsOverride } from '@core/request-meta';
import {
  changeUserSettings,
  checkLogin,
  closeUserSessions,
  confirmOperation,
  getUserInfo,
  getUserSessions,
  openSession,
  resendOperation,
  signin,
  signup,
} from './api/authApi';

/**
 * Сквозная проверка среза через реальный authApi + интерсепторы httpClient против MSW-сервера
 * (cookie-mode happy-path: refresh не дёргаем, access берётся из applyAccess). Проверяет, что
 * signin → confirm(204) → openSession(201) → getUserInfo связаны корректно и что неверный код
 * возвращает operation_state.
 */
describe('auth flow (signin → confirm → session → profile)', () => {
  beforeEach(() => {
    useAuthStore.getState().setAnonymous();
    // getUserInfo применяет язык профиля через i18next — в приложении инстанс поднят бутстрапом
    // (main.tsx) задолго до первого запроса, здесь воспроизводим то же условие. Идемпотентно.
    initI18n();
  });

  it('успешный вход открывает сессию и отдаёт профиль', async () => {
    const op = await signin('user@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const next = await confirmOperation({ token: op.token, secret: '183947' });
    expect(next).toBeNull(); // 204 — подтверждено

    const result = await openSession({ token: op.token, secret: '183947' });
    expect(result.kind).toBe('access');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBeTruthy();

    const user = await getUserInfo();
    expect(user.email).toBe('user@example.com');
    expect(user.realms[0]?.user_kind).toBe('standard');
    expect(user.status).toBe('ENABLED');
  });

  it('неверный код → ApiFieldError с operation_state и уменьшенным счётчиком', async () => {
    const op = await signin('user@example.com');
    await expect(confirmOperation({ token: op.token, secret: '000000' })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError &&
        e.operationState?.remaining_attempts === 2 &&
        e.fields[0]?.code === 'secret',
    );
  });

  it('регистрация создаёт операцию с confirm_method EMAIL и открывает сессию', async () => {
    const op = await signup('newuser@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const confirmed = await confirmOperation({ token: op.token, secret: '183947' });
    expect(confirmed).toBeNull();

    const result = await openSession({ token: op.token, secret: '183947' });
    expect(result.kind).toBe('access');

    const user = await getUserInfo();
    expect(user.email).toBe('newuser@example.com');
  });

  it('check-login: свободный email → true (204)', async () => {
    await expect(checkLogin('brand-new@example.com')).resolves.toBe(true);
  });

  it('check-login: занятый email → ApiFieldError (400) с деталью под поле', async () => {
    await expect(checkLogin('taken@example.com')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'user_login',
    );
  });

  it('signup с активным локом регистрации → ApiFieldError с бизнес-code (не поле формы)', async () => {
    await expect(signup('inprogress@example.com')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code !== 'user_email',
    );
  });

  it('открытая сессия видна в /v1/sessions как текущая, closeUserSessions её убирает', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token, secret: '183947' });

    const sessions = await getUserSessions();
    const current = sessions.filter((s) => s.is_current);
    expect(current).toHaveLength(1);
    // session_id в запросах ограничен 8 символами (Auth.Sessions.Request.Model.SessionID).
    expect(sessions.every((s) => s.session_id.length === 8)).toBe(true);

    const victim = sessions.find((s) => !s.is_current)!;
    await closeUserSessions([victim.session_id]);

    const after = await getUserSessions();
    expect(after).toHaveLength(sessions.length - 1);
    expect(after.some((s) => s.session_id === victim.session_id)).toBe(false);
    expect(after.some((s) => s.is_current)).toBe(true);
  });

  it('getUserInfo применяет язык профиля к интерфейсу — но не поверх выбора в шелле', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token, secret: '183947' });

    // Мок отдаёт профиль с lang: 'ru-RU' — в хранилище должен лечь код языка, не локаль.
    await getUserInfo();
    expect(getLanguage()).toBe('ru');
    expect(getLanguageSource()).toBe('profile');

    // Пользователь выбрал язык в навигации — следующий заход за профилем его не перебивает.
    setLanguage('en');
    await getUserInfo();
    expect(getLanguage()).toBe('en');
    expect(getLanguageSource()).toBe('local');
  });

  it('сохранение настроек: профиль обгоняет токен, продление сессии их сводит', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token, secret: '183947' });

    const before = await getUserInfo();
    expect(before.tz).toBe('Europe/Moscow');
    // Даты ответа — в поясе снимка токена (+03:00), а не в UTC.
    expect(before.realms[0]!.created_at).toContain('+03:00');

    // Язык оставляем русским: проверяем окно по поясу, лишняя смена языка только зашумила бы.
    const saved = await changeUserSettings({ lang: 'ru-RU', tz: 'Asia/Tokyo' });
    expect(saved).toEqual({ lang: 'ru-RU', tz: 'Asia/Tokyo' });

    // Окно рассинхрона. Профиль отдаёт новые значения сразу, а даты приходят в новом поясе
    // потому, что оверрайд шлёт ?tz.
    const during = await getUserInfo();
    expect(during.tz).toBe('Asia/Tokyo');
    expect(during.realms[0]!.created_at).toContain('+09:00');

    // Без оверрайда видно, что токен всё ещё старый: сервер формирует ответ по своему снимку,
    // хотя поле tz профиля уже новое. Это и есть окно — единственная проверка,
    // которая его целиком описывает.
    clearSettingsOverride();
    const withoutOverride = await getUserInfo();
    expect(withoutOverride.tz).toBe('Asia/Tokyo');
    expect(withoutOverride.realms[0]!.created_at).toContain('+03:00');

    // Продление переносит настройки в токен: даты идут в новом поясе уже без всякого оверрайда.
    expect(await refresh()).toBe(true);
    const after = await getUserInfo();
    expect(after.realms[0]!.created_at).toContain('+09:00');

    // Профиль мока живёт в модуле и переживает тест — возвращаем исходные настройки, чтобы
    // соседние кейсы не зависели от порядка запуска.
    await changeUserSettings({ lang: 'ru-RU', tz: 'Europe/Moscow' });
  });

  it('значения, которых нет у сервера, → 400 по своему полю', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token, secret: '183947' });

    // Зона есть в справочнике фронта, но мок её отвергает: так проверяется ветка, ради которой
    // явные значения объявлены строгими, — список фронта может отстать от серверного.
    await expect(changeUserSettings({ tz: 'Etc/GMT+12' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'tz',
    );
    // У языка та же строгость, но справочного значения под неё нет (отказ от en-US в моке живёт
    // за флагом VITE_MOCK_REJECT_LANG, иначе в демо не сохранить английский). Берём язык вне
    // справочника — путь тот же, поле то же.
    await expect(changeUserSettings({ lang: 'fr-FR' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'lang',
    );

    // Профиль при этом не поменялся — сервер ничего не сохранил.
    const after = await getUserInfo();
    expect(after.tz).toBe('Europe/Moscow');
    expect(after.lang).toBe('ru-RU');
  });

  it('«Авто» подбирает пояс по заголовку, незнакомое имя — по смещению', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token, secret: '183947' });

    // Зоны ОС может не быть в справочнике приложения: сервер подберёт соседа по смещению,
    // и клиенту важно применить именно то, что вернулось, а не то, что он просил.
    const saved = await changeUserSettings({});
    expect(saved.tz).not.toBe('');
    expect(TIME_ZONES.some((z) => z.id === saved.tz)).toBe(true);
  });

  it('resend возвращает новый WaitingConfirmOperation со сброшенными счётчиками', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '000000' }).catch(() => undefined);
    const resent = await resendOperation({ token: op.token });
    expect(resent.remaining_attempts).toBe(3);
    expect(resent.remaining_resends).toBe(1);
  });
});
