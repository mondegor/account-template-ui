/** Auth-домен DTO (из contracts/auth/openapi.yaml). */

/**
 * Метод подтверждения текущего звена цепочки. `RECOVERY` — одноразовый аварийный код отдельным
 * звеном: он бывает только последним и только у операций, созданных методами `.../recovery`
 * (вход и смена емаила при утраченном доступе к почте). Там же, где аварийный код принимается
 * ВМЕСТО второго фактора, отдельного звена нет — метод остаётся `PASSWORD`/`TOTP`.
 */
export type ConfirmMethod = 'EMAIL' | 'PHONE' | 'PASSWORD' | 'TOTP' | 'RECOVERY';
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

/** Тип защищённой операции, ожидающей подтверждения либо применения. */
export type OperationType =
  | 'CREATE_USER'
  | 'AUTHORIZE_USER'
  /** Смена емаила, шаг 1: подтверждение владения аккаунтом. */
  | 'CHANGE_EMAIL'
  /** Смена емаила, шаг 2: подтверждение владения новым адресом. */
  | 'CHANGE_EMAIL_CONFIRM'
  | 'CHANGE_PHONE'
  | 'CHANGE_PASSWORD'
  | 'CHANGE_TOTP'
  | 'REGENERATE_RECOVERY'
  | 'DISABLE_2FA';

/** `OPENED` — ждёт подтверждения кодом; `CONFIRMED` — ждёт применения завершающим методом. */
export type OperationStatus = 'OPENED' | 'CONFIRMED';

/**
 * Незакрытая операция пользователя в его профиле: тем же токеном она подтверждается,
 * переотправляет код, отзывается и применяется завершающим методом своего потока.
 */
export interface PendingOperation {
  token: string;
  type: OperationType;
  /** Значение для показа пользователю; приходит только у операций смены адреса. */
  extra_value?: string;
  expires_at: string;
  status: OperationStatus;
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
  /** Действующие операции, ожидающие подтверждения либо применения. Экрана-потребителя пока нет. */
  pending_operations?: PendingOperation[];
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

/**
 * Надёжность пароля глазами сервера (`Auth.Enum.PasswordStrength`). Считает её он, а не клиент:
 * правила у развёртывания свои, и своя оценка на экране расходилась бы с тем, что примет
 * `POST /v1/security/password`.
 */
export type PasswordStrength = 'NOT_RATED' | 'WEAK' | 'MIDDLE' | 'STRONG' | 'THE_BEST';

/** Тело POST /v1/check/calc-password-strength (границы те же 8..32, что и у самого пароля). */
export interface CalcPasswordStrengthRequest {
  password: string;
}

/** Ответ POST /v1/check/calc-password-strength. */
export interface CalcPasswordStrengthResponse {
  strength: PasswordStrength;
}

/**
 * Ответ POST /v1/check/generate-password: пароль, придуманный за пользователя. По спеке его
 * надёжность всегда `THE_BEST`, поэтому оценку для него не запрашивают.
 */
export interface GeneratedPassword {
  password: string;
}
