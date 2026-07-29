import { authClient, setSettingsOverride } from '@core/api';
import { authStore, realmProvider, tokenStorage, applyAccess } from '@core/auth';
import { adoptProfileLanguage, buildTimeZoneHeader } from '@core/i18n';
import type {
  ChangeUserSettingsRequest,
  ConfirmOperationRequest,
  LoginByTokenRequest,
  OpenSessionResult,
  OperationTokenRequest,
  SuccessAccess,
  UserInfo,
  UserSession,
  UserSettings,
  WaitingConfirmOperation,
} from './types';

/**
 * Тонкий слой над Auth API. realm подставляется из realmProvider (в UI не вводится).
 * Ошибки уже нормализованы интерсептором (ApiFieldError / ApiProblemError).
 */

/** Шаг 1 входа: инициирует операцию, сервер шлёт код. → WaitingConfirmOperation (200). */
export async function signin(userLogin: string): Promise<WaitingConfirmOperation> {
  const res = await authClient.post<WaitingConfirmOperation>('/v1/signin', {
    realm: realmProvider.getRealm(),
    user_login: userLogin,
  });
  return res.data;
}

/**
 * Шаг 1 регистрации: создаёт операцию по email, сервер шлёт код. → WaitingConfirmOperation (200).
 *
 * Язык и пояс тело не несёт: сервер берёт их из самого запроса и фиксирует в профиле нового
 * пользователя на подтверждении кода — другого шанса задать пояс до POST /v1/user/settings
 * у пользователя не будет. Оба доезжают сами, ничего точечного тут не нужно: язык — `?lang`
 * при явном выборе в шелле, иначе браузерный `Accept-Language`; пояс — `X-Accept-Time-Zone`,
 * который интерсептор ставит на каждый запрос без токена (httpClient).
 */
export async function signup(userEmail: string): Promise<WaitingConfirmOperation> {
  const res = await authClient.post<WaitingConfirmOperation>('/v1/signup', {
    realm: realmProvider.getRealm(),
    user_email: userEmail,
  });
  return res.data;
}

/**
 * Проверка доступности логина для регистрации. 204 → свободно (true).
 * 400 (ApiFieldError) «занят/невалиден» НЕ глотаем — прокидываем вызывающему.
 * Поле запроса — `user_login` (схема CheckLogin), значение — тот же email.
 */
export async function checkLogin(userLogin: string): Promise<boolean> {
  const res = await authClient.post('/v1/check/check-login', {
    realm: realmProvider.getRealm(),
    user_login: userLogin,
  });
  return res.status === 204;
}

/** Подтверждение кода. 204 = операция подтверждена; 200 = следующее звено цепочки. */
export async function confirmOperation(
  req: ConfirmOperationRequest,
): Promise<WaitingConfirmOperation | null> {
  const res = await authClient.patch<WaitingConfirmOperation | ''>('/v1/operation/confirm', req);
  return res.status === 204 ? null : (res.data as WaitingConfirmOperation);
}

/** Повторная отправка кода. → новый WaitingConfirmOperation (сброс счётчиков). */
export async function resendOperation(
  req: OperationTokenRequest,
): Promise<WaitingConfirmOperation> {
  const res = await authClient.patch<WaitingConfirmOperation>('/v1/operation/resend', req);
  return res.data;
}

/**
 * Отмена операции (204). Метод класса `any-users`: отзыв доступен только авторизованному,
 * и 401 у него — протухший access, который интерсептор гасит продлением. Гость (кнопка «Отменить»
 * на подтверждении входа и регистрации) права на отзыв не имеет — сервер ответил бы 401, поэтому
 * запроса не делаем вовсе: гостевая операция живёт на сервере до истечения.
 */
export async function revokeOperation(req: OperationTokenRequest): Promise<void> {
  if (!authStore.getAccess()) return;
  await authClient.patch('/v1/operation/revoke', req);
}

/**
 * Открытие сессии по подтверждённой операции. 200 = ещё подтверждение (2FA), 201 = токены.
 * Веб шлёт X-Use-Cookie: true — refresh уедет в HttpOnly-cookie RTID.
 */
export async function openSession(req: LoginByTokenRequest): Promise<OpenSessionResult> {
  const res = await authClient.post<WaitingConfirmOperation | SuccessAccess>('/v1/session', req, {
    headers: tokenStorage.useCookieHeader ? { 'X-Use-Cookie': 'true' } : undefined,
  });
  if (res.status === 201) {
    const access = res.data as SuccessAccess;
    applyAccess(access);
    return { kind: 'access', access };
  }
  return { kind: 'waiting', operation: res.data as WaitingConfirmOperation };
}

/**
 * Профиль текущего пользователя.
 *
 * Здесь же применяем язык профиля к интерфейсу: это единственная воронка профильных данных (её
 * зовут и ProfilePage, и SessionsPage), поэтому сайд-эффект тут надёжнее, чем useEffect на каждой
 * странице — иначе язык подтягивался бы не везде и по-разному. Локальный выбор в шелле
 * adoptProfileLanguage не перебивает (см. @core/i18n/languageSync).
 */
export async function getUserInfo(): Promise<UserInfo> {
  const res = await authClient.get<UserInfo>('/v1/user');
  adoptProfileLanguage(res.data.lang);
  return res.data;
}

/**
 * Сохранение языка и часового пояса профиля (POST /v1/user/settings).
 *
 * Тело собирает форма: явно выбранное значение → поле, «Авто» → поля НЕТ вовсе (пустая строка
 * по спеке невалидна). «Авто» значит «подбери по моему текущему окружению», а окружение — это
 * явный выбор в навигации, если он есть, иначе сигнал браузера. Поэтому:
 *  - язык: `?lang` (выбор в шелле) либо браузерный Accept-Language — оба уходят сами;
 *  - пояс: заголовок X-Accept-Time-Zone — единственное место, где его приходится ставить руками.
 *    Запрос авторизованный, поэтому интерсептор (он ставит заголовок только гостям) его не тронет,
 *    а «Авто» здесь как раз про окружение, а не про токен. Собираем только когда tz не задан явно:
 *    при явном значении заголовок всё равно проигрывает телу.
 *    Появится переключатель пояса в навигации — перед заголовком встанет `?tz`, как у языка;
 *  - `skipSettingsOverride` снимает с этого запроса оверрайд ПРОШЛОГО сохранения: query
 *    выигрывает у заголовка, и старое значение подменило бы подбор по текущему окружению —
 *    ровно то, чего режим «Авто» делать не должен.
 *
 * После успеха применяем ОТВЕТ (в «Авто» он несёт подобранное значение, а не запрошенное):
 * кладём оба значения в оверрайд окна и подтягиваем язык интерфейса. Инвалидация кэша —
 * забота вызывающего (у него queryClient).
 */
export async function changeUserSettings(req: ChangeUserSettingsRequest): Promise<UserSettings> {
  const res = await authClient.post<UserSettings>('/v1/user/settings', req, {
    skipSettingsOverride: true,
    headers: req.tz ? {} : { 'X-Accept-Time-Zone': buildTimeZoneHeader() },
  });
  setSettingsOverride({ lang: res.data.lang, tz: res.data.tz });
  adoptProfileLanguage(res.data.lang);
  return res.data;
}

/** Открытые сессии реалма. Без realm — реалм текущей сессии (здесь его выбирает пользователь). */
export async function getUserSessions(realm?: string): Promise<UserSession[]> {
  const res = await authClient.get<UserSession[]>('/v1/sessions', {
    params: realm ? { realm } : undefined,
  });
  return res.data;
}

/**
 * Закрытие перечисленных сессий (204). Единственный способ убрать сессию из списка — в т.ч. одну.
 * Ограничение session_ids (1..64, CloseSessions) выполняется само: больше 64 сессий у пользователя
 * не бывает, а пустой список сюда не доходит (SessionsPage не пускает mutate([])).
 */
export async function closeUserSessions(sessionIds: string[]): Promise<void> {
  await authClient.post('/v1/sessions/close', { session_ids: sessionIds });
}
