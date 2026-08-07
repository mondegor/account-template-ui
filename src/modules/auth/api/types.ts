/** Auth-домен DTO (из contracts/auth/openapi.yaml). */

export type ConfirmMethod = 'EMAIL' | 'PHONE' | 'PASSWORD' | 'TOTP';
export type UserAuth2fa = 'NONE' | 'PASSWORD' | 'TOTP';
export type UserStatus = 'DRAFT' | 'ENABLED' | 'DISABLED' | 'BLOCKED';

export interface AuthorizeUserRequest {
  realm: string;
  user_login: string;
}

export interface CreateUserRequest {
  realm: string;
  user_email: string;
}

export interface WaitingConfirmOperation {
  /**
   * Токен ТЕКУЩЕГО звена цепочки подтверждений: при переходе к следующему выдаётся новый, а
   * предыдущий сразу перестаёт действовать. Клиент всегда работает с токеном последнего
   * полученного звена — им же зовётся и завершающий метод операции.
   */
  token: string;
  confirm_method: ConfirmMethod;
  remaining_attempts: number;
  remaining_resends?: number;
  resends_in?: number;
  expires_in: number;
  message?: string;
}

export interface LoginByTokenRequest {
  token: string;
  secret?: string;
}

export interface SuccessAccess {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  message?: string;
}

export interface ConfirmOperationRequest {
  token: string;
  secret: string;
}

export interface OperationTokenRequest {
  token: string;
}

export interface UserRealm {
  name: string;
  user_kind: string;
  last_location?: string;
  last_logged_at?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Профиль пользователя.
 */
export interface UserInfo {
  email: string;
  phone?: string;
  /** Язык профиля (ru-RU). Тексты ответа идут по языку из токена — в окне рассинхрона расходятся. */
  lang: string;
  /** Часовой пояс профиля (IANA). В окне рассинхрона тоже опережает токен. */
  tz: string;
  auth_2fa_type: UserAuth2fa;
  /**
   * Остаток неиспользованных одноразовых аварийных кодов; 0 = коды исчерпаны и их нужно
   * перевыпустить. Поля НЕТ, когда 2FA выключена (`auth_2fa_type`: `NONE`).
   */
  recovery_codes_left?: number;
  realms: UserRealm[];
  /** Состояние учётной записи. Интерфейс его не показывает: распоряжается им не пользователь. */
  status: UserStatus;
}

/** Тело POST /v1/user/settings: пропуск поля = режим «авто» (пустая строка невалидна). */
export interface ChangeUserSettingsRequest {
  lang?: string;
  tz?: string;
}

/** Ответ POST /v1/user/settings: оба значения фактически сохранены (в «авто» — подобраны бэком). */
export interface UserSettings {
  lang: string;
  tz: string;
}

/** Открытая сессия пользователя. session_id — 8 символов (в запросах длина фиксирована). */
export interface UserSession {
  session_id: string;
  app_name: string;
  device_name: string;
  last_ip: string;
  /** Только если было вычислено — в UI строка скрывается. */
  location?: string;
  created_at: string;
  last_seen_at: string;
  expires_at?: string;
  is_current: boolean;
}

/** Результат открытия сессии: либо ещё одно подтверждение (200), либо токены (201). */
export type OpenSessionResult =
  | { kind: 'waiting'; operation: WaitingConfirmOperation }
  | { kind: 'access'; access: SuccessAccess };

/** Тело POST /v1/security/password: пароль устанавливается вторым фактором (границы 8..32). */
export interface ChangePasswordRequest {
  new_password: string;
}

/**
 * Тело завершающих методов операции (`apply-password`, `apply-recovery-codes`, `apply-operation`).
 * Секрета здесь нет: операция подтверждена полностью, и сервер это поле не принимает.
 */
export interface ApplyByTokenRequest {
  token: string;
}

/** Тело POST /v1/security/apply-totp: код из приложения подтверждает, что генератор заведён. */
export interface ApplyTotpRequest {
  token: string;
  totp_code: string;
}

/**
 * Аварийные коды, выданные при включении 2FA или при перевыпуске. Показываются ровно один раз —
 * повторно сервер их не отдаёт.
 */
export interface RecoveryCodes {
  recovery_codes: string[];
}

/** Заготовка генератора TOTP: Base32-секрет для ручного ввода и ссылка otpauth:// для приложения. */
export interface TotpSecret {
  secret: string;
  otpauth_uri: string;
}
