import { GuestOnly, ProtectedRoute } from '@core/auth';
import type { ModuleDefinition } from '@core/module-registry';
import { SigninPage } from './pages/SigninPage';
import { SigninRecoveryPage } from './pages/SigninRecoveryPage';
import { SignupPage } from './pages/SignupPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';
import { SessionsPage } from './pages/SessionsPage';
import { PasswordSetupPage } from './pages/PasswordSetupPage';
import { SecurityConfirmPage } from './pages/SecurityConfirmPage';
import { RecoveryCodesPage } from './pages/RecoveryCodesPage';
import { ConfirmOperationNode } from './ui/ConfirmOperationNode';
import { EmailFieldNode } from './ui/EmailFieldNode';
import { authTranslations } from './i18n';
import { initAuthModule } from './register';
import signupSchema from './schemas/signup.json';
import signinSchema from './schemas/signin.json';
import signinRecoverySchema from './schemas/signinRecovery.json';
import confirmSchema from './schemas/confirm.json';

/**
 * ModuleDefinition модуля auth: роуты (с guard-обёртками — guest/protected — заботой модуля),
 * навигация, локальные схемы, тип узла confirmOperation, переводы и onInit (обработчики схем).
 * Реестр собирает из этого роуты/nav — ядро при подключении не меняется.
 */
export const authModule: ModuleDefinition = {
  id: 'auth',
  routes: [
    {
      path: '/signin',
      element: (
        <GuestOnly>
          <SigninPage />
        </GuestOnly>
      ),
    },
    {
      path: '/signin/recovery',
      element: (
        <GuestOnly>
          <SigninRecoveryPage />
        </GuestOnly>
      ),
    },
    {
      path: '/signup',
      element: (
        <GuestOnly>
          <SignupPage />
        </GuestOnly>
      ),
    },
    // confirm доступен и гостю, и в процессе цепочки — без guard.
    { path: '/confirm', element: <ConfirmPage /> },
    {
      path: '/profile',
      element: (
        <ProtectedRoute>
          <ProfilePage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/settings',
      element: (
        <ProtectedRoute>
          <SettingsPage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/sessions',
      element: (
        <ProtectedRoute>
          <SessionsPage />
        </ProtectedRoute>
      ),
    },
    // Потоки защиты аккаунта. Подтверждение здесь своё, а не общее /confirm: те операции
    // авторизованные, закрывает их свой apply-*, и заканчиваются они в настройках, а не в кабинете.
    {
      path: '/security/password',
      element: (
        <ProtectedRoute>
          <PasswordSetupPage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/security/confirm',
      element: (
        <ProtectedRoute>
          <SecurityConfirmPage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/security/codes',
      element: (
        <ProtectedRoute>
          <RecoveryCodesPage />
        </ProtectedRoute>
      ),
    },
  ],
  nav: [
    { id: 'auth.profile', label: 'auth.nav.profile', route: '/profile' },
    { id: 'auth.sessions', label: 'auth.nav.sessions', route: '/sessions' },
    { id: 'auth.settings', label: 'auth.nav.settings', route: '/settings' },
  ],
  schemas: {
    'auth.signup': signupSchema,
    'auth.signin': signinSchema,
    'auth.signinRecovery': signinRecoverySchema,
    'auth.confirm': confirmSchema,
  },
  fieldTypes: ['auth.emailField'],
  componentTypes: {
    confirmOperation: ConfirmOperationNode,
    'auth.emailField': EmailFieldNode,
  },
  i18n: authTranslations,
  onInit: () => initAuthModule(),
};
