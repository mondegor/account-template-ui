import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logout, refresh, useAuthStore } from '@core/auth';
import { ApiFieldError, ApiRateLimitError } from '@core/api';
import { TIME_ZONES, getLanguage, getLanguageSource, initI18n, setLanguage } from '@core/i18n';
import { clearSettingsOverride } from '@core/request-meta';
import { resetMockState } from '@mocks/handlers';
import {
  applyOperation,
  applyPassword,
  changeUserSettings,
  checkLogin,
  closeUserSessions,
  confirmOperation,
  getUserInfo,
  getUserSessions,
  openSession,
  resendOperation,
  signin,
  signinByRecovery,
  signup,
  startDisable2fa,
  startPasswordSetup,
} from './api/authApi';

/** Проходит цепочку звеньев подряд и возвращает токен ПОСЛЕДНЕГО: у каждого звена он свой. */
async function confirmChain(token: string, secrets: string[]): Promise<string> {
  let current = token;
  for (const secret of secrets) {
    const next = await confirmOperation({ token: current, secret });
    if (next) current = next.token;
  }
  return current;
}

/**
 * Включает второй фактор аккаунта и оставляет сессию открытой. Фактор — состояние аккаунта, а не
 * настройка кейса, поэтому получить аккаунт с 2FA можно только пройдя установку пароля целиком.
 */
async function enable2fa() {
  const op = await signin('user@example.com');
  await confirmOperation({ token: op.token, secret: '183947' });
  await openSession({ token: op.token });
  const setup = await startPasswordSetup({ new_password: 'Str0ngPass!' });
  await applyPassword({ token: await confirmChain(setup.token, ['183947']) });
}

/**
 * Сквозная проверка среза через реальный authApi + интерсепторы httpClient против MSW-сервера
 * (cookie-mode happy-path: refresh не дёргаем, access берётся из applyAccess). Проверяет, что
 * signin → confirm(204) → openSession(201) → getUserInfo связаны корректно и что неверный код
 * возвращает operation_state.
 */
describe('auth flow (signin → confirm → session → profile)', () => {
  beforeEach(() => {
    // Второй фактор и остаток аварийных кодов у мока — состояние: без сброса кейсы читали бы
    // env-флаги разработчика и краснели бы у того, кто настроил окружение по .env.example.
    resetMockState();
    useAuthStore.getState().setAnonymous();
    // getUserInfo применяет язык профиля через i18next — в приложении инстанс поднят бутстрапом
    // (main.tsx) задолго до первого запроса, здесь воспроизводим то же условие. Идемпотентно.
    initI18n();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a successful sign-in opens a session and returns the profile', async () => {
    const op = await signin('user@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const next = await confirmOperation({ token: op.token, secret: '183947' });
    expect(next).toBeNull(); // 204 — подтверждено

    const result = await openSession({ token: op.token });
    expect(result.kind).toBe('access');
    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().accessToken).toBeTruthy();

    const user = await getUserInfo();
    expect(user.email).toBe('user@example.com');
    expect(user.realms[0]?.user_kind).toBe('standard');
    expect(user.status).toBe('ENABLED');
  });

  it('a wrong code gives an ApiFieldError with operation_state and a decremented counter', async () => {
    const op = await signin('user@example.com');
    await expect(confirmOperation({ token: op.token, secret: '000000' })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError &&
        e.operationState?.remaining_attempts === 2 &&
        e.fields[0]?.code === 'ConfirmCodeIsIncorrect/secret',
    );
  });

  /**
   * `expires_in` — ОСТАТОК срока, а не полный срок операции: клиент пересчитывает дедлайн от
   * каждого ответа, и полное значение отматывало бы таймер назад на каждом неверном коде. Тогда
   * операция умирала бы, пока на экране ещё остаются минуты.
   */
  it('the operation does not get younger: a 400 carries the remaining lifetime, not the full one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const op = await signin('user@example.com');
    expect(op.expires_in).toBe(600);

    await vi.advanceTimersByTimeAsync(120_000);

    const err = await confirmOperation({ token: op.token, secret: '000000' }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiFieldError);
    expect((err as ApiFieldError).operationState?.expires_in).toBeLessThanOrEqual(480);

    // Пережившая срок операция отвечает уже по токену, а не по коду.
    await vi.advanceTimersByTimeAsync(481_000);
    await expect(confirmOperation({ token: op.token, secret: '183947' })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError && e.fields[0]?.code === 'OperationAlreadyExpired/token',
    );
  });

  it('signup creates an operation with confirm_method EMAIL and opens a session', async () => {
    const op = await signup('newuser@example.com');
    expect(op.token).toHaveLength(64);
    expect(op.confirm_method).toBe('EMAIL');
    expect(op.remaining_attempts).toBe(3);

    const confirmed = await confirmOperation({ token: op.token, secret: '183947' });
    expect(confirmed).toBeNull();

    const result = await openSession({ token: op.token });
    expect(result.kind).toBe('access');

    const user = await getUserInfo();
    expect(user.email).toBe('newuser@example.com');
  });

  /**
   * Резервный вход — единственный поток среза с цепочкой из двух звеньев: письма в нём нет, а
   * доказательства идут по очереди (второй фактор, затем одноразовый аварийный код). Секреты —
   * фикстуры мока, поэтому здесь они литералами.
   *
   * Второй фактор аккаунту нужен: без него предъявить на первом звене нечего, и до сессии этот
   * поток не доходит вовсе — набора аварийных кодов у такого аккаунта тоже нет.
   */
  it('the backup sign-in walks the two links and opens a session', async () => {
    await enable2fa();
    useAuthStore.getState().setAnonymous();

    const factor = await signinByRecovery('user@example.com');
    expect(factor.confirm_method).toBe('PASSWORD');
    // Отправлять на таком звене нечего, поэтому полей повторной отправки в ответе нет вовсе —
    // именно по их отсутствию клиент и убирает со экрана «Отправить повторно».
    expect(factor.remaining_resends).toBeUndefined();
    expect(factor.resends_in).toBeUndefined();

    const recovery = await confirmOperation({ token: factor.token, secret: 'MockPass2026!' });
    expect(recovery?.confirm_method).toBe('RECOVERY');
    // У каждого звена свой токен, и предыдущий перестаёт действовать сразу.
    expect(recovery?.token).not.toBe(factor.token);
    await expect(
      confirmOperation({ token: factor.token, secret: 'MockPass2026!' }),
    ).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'OperationInvalid/token',
    );

    const done = await confirmOperation({ token: recovery!.token, secret: 'RECOVRY1-CODE0011' });
    expect(done).toBeNull();

    const result = await openSession({ token: recovery!.token });
    expect(result.kind).toBe('access');
    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  /**
   * Вход при включённой 2FA идёт двумя звеньями: код с емаила, затем второй фактор. У каждого звена
   * свой секрет-фикстура, и последнее звено подтверждается прямо методом открытия сессии.
   */
  it('a sign-in with 2FA on asks for the email code and then the second factor', async () => {
    await enable2fa();
    useAuthStore.getState().setAnonymous();

    const op = await signin('user@example.com');
    expect(op.confirm_method).toBe('EMAIL');

    const factor = await confirmOperation({ token: op.token, secret: '183947' });
    expect(factor?.confirm_method).toBe('PASSWORD');
    // На звене фактора отправлять нечего — полей повторной отправки в ответе нет.
    expect(factor?.remaining_resends).toBeUndefined();
    expect(factor?.resends_in).toBeUndefined();

    const result = await openSession({ token: factor!.token, secret: 'MockPass2026!' });
    expect(result.kind).toBe('access');
  });

  /**
   * Второй фактор отключили из соседней вкладки, пока операция входа ждала его звена. Отдельного
   * кода у этой ветки нет: звено отвечает обычным «неверный код», иначе по ответу гостевого метода
   * читалось бы состояние 2FA аккаунта.
   */
  it('2FA switched off after the operation was created comes back as a plain wrong code', async () => {
    await enable2fa();
    const pending = await signin('user@example.com');
    const factor = await confirmOperation({ token: pending.token, secret: '183947' });

    const off = await startDisable2fa();
    await applyOperation({ token: await confirmChain(off.token, ['183947', 'RECOVRY1-CODE0011']) });
    expect((await getUserInfo()).auth_2fa_type).toBe('NONE');

    await expect(confirmOperation({ token: factor!.token, secret: '183947' })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError && e.fields[0]?.code === 'ConfirmCodeIsIncorrect/secret',
    );
  });

  it('resending on a second-factor link is refused: there is no message to send', async () => {
    const factor = await signinByRecovery('user@example.com');
    await expect(resendOperation({ token: factor.token })).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError && e.fields[0]?.code === 'ResendCodeIsNotSupported/token',
    );
  });

  it('check-login: a free email gives true (204)', async () => {
    await expect(checkLogin('brand-new@example.com')).resolves.toBe(true);
  });

  it('check-login: a taken email gives an ApiFieldError (400) with a per-field detail', async () => {
    await expect(checkLogin('taken@example.com')).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ApiFieldError && e.fields[0]?.code === 'EmailAlreadyExists/user_login',
    );
  });

  it('signup while the registration lock is active gives a 429 with Retry-After (the anti-spam throttle)', async () => {
    await expect(signup('inprogress@example.com')).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiRateLimitError && e.retryAfterSec === 600,
    );
  });

  it('an opened session shows up in /v1/sessions as the current one, and closeUserSessions removes it', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });

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

  it('getUserInfo applies the profile language to the interface, but never over a choice made in the shell', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });

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

  it('saving settings: the profile runs ahead of the token, and a session refresh brings them together', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });

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

  it('values the server does not know give a 400 on their own field', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });

    // Зона есть в справочнике фронта, но мок её отвергает: так проверяется ветка, ради которой
    // явные значения объявлены строгими, — список фронта может отстать от серверного.
    await expect(changeUserSettings({ tz: 'Etc/GMT+12' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'ValidateError/tz',
    );
    // У языка та же строгость, но справочного значения под неё нет (отказ от en-US в моке живёт
    // за флагом VITE_MOCK_REJECT_LANG, иначе в демо не сохранить английский). Берём язык вне
    // справочника — путь тот же, поле то же.
    await expect(changeUserSettings({ lang: 'fr-FR' })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiFieldError && e.fields[0]?.code === 'ValidateError/lang',
    );

    // Профиль при этом не поменялся — сервер ничего не сохранил.
    const after = await getUserInfo();
    expect(after.tz).toBe('Europe/Moscow');
    expect(after.lang).toBe('ru-RU');
  });

  it('«Auto» matches the zone by the header, and an unknown name by the offset', async () => {
    localStorage.clear();
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });

    // Зоны ОС может не быть в справочнике приложения: сервер подберёт соседа по смещению,
    // и клиенту важно применить именно то, что вернулось, а не то, что он просил.
    const saved = await changeUserSettings({});
    expect(saved.tz).not.toBe('');
    expect(TIME_ZONES.some((z) => z.id === saved.tz)).toBe(true);
  });

  it('resend returns a fresh WaitingConfirmOperation with the counters reset', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '000000' }).catch(() => undefined);
    const resent = await resendOperation({ token: op.token });
    expect(resent.remaining_attempts).toBe(3);
    expect(resent.remaining_resends).toBe(1);
  });

  it('signing out twice: there is nothing left to close, the method is idempotent', async () => {
    const op = await signin('user@example.com');
    await confirmOperation({ token: op.token, secret: '183947' });
    await openSession({ token: op.token });
    expect(useAuthStore.getState().status).toBe('authenticated');

    await logout();
    // Сессия закрыта первым выходом, поэтому второму DELETE закрывать нечего — по спеке он молча
    // отвечает 204. Клиента это не должно ни ронять, ни оставлять залогиненным.
    await logout();

    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
