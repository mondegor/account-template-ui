/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_API_BASE_URL: string;
  readonly VITE_AUTH_REALM: string;
  readonly VITE_TOKEN_MODE: 'cookie' | 'body';
  readonly VITE_ENABLE_MOCKS?: string;
  readonly VITE_MOCK_MULTI_REALM?: string;
  readonly VITE_MOCK_REJECT_LANG?: string;
  readonly VITE_MOCK_2FA?: string;
  readonly VITE_MOCK_RECOVERY_CODES?: string;
  readonly VITE_MOCK_SESSION_LIMIT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
