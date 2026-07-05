/** Auth-домен DTO (из docs/api/auth/openapi.yaml). */

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
  expires_in?: number;
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
  created_at: string;
  updated_at: string;
}

export interface UserInfo {
  email: string;
  phone?: string;
  lang: string;
  last_login_ip: string;
  last_logged_at: string;
  auth_2fa_type: UserAuth2fa;
  realms: UserRealm[];
  status: UserStatus;
  created_at: string;
  updated_at: string;
}

/** Результат открытия сессии: либо ещё одно подтверждение (200), либо токены (201). */
export type OpenSessionResult =
  | { kind: 'waiting'; operation: WaitingConfirmOperation }
  | { kind: 'access'; access: SuccessAccess };
