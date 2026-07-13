import { GuestOnly, ProtectedRoute } from '@core/auth';
import type { ModuleDefinition } from '@core/module-registry';
import { SigninPage } from './pages/SigninPage';
import { SignupPage } from './pages/SignupPage';
import { ConfirmPage } from './pages/ConfirmPage';
import { ProfilePage } from './pages/ProfilePage';
import { SessionsPage } from './pages/SessionsPage';
import { ConfirmOperationNode } from './ui/ConfirmOperationNode';
import { EmailFieldNode } from './ui/EmailFieldNode';
import { authTranslations } from './i18n';
import { registerAuthHandlers } from './register';
import signupSchema from './schemas/signup.json';
import signinSchema from './schemas/signin.json';
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
      path: '/sessions',
      element: (
        <ProtectedRoute>
          <SessionsPage />
        </ProtectedRoute>
      ),
    },
  ],
  nav: [
    { id: 'auth.profile', label: 'auth.nav.profile', route: '/profile' },
    { id: 'auth.sessions', label: 'auth.nav.sessions', route: '/sessions' },
  ],
  schemas: {
    'auth.signup': signupSchema,
    'auth.signin': signinSchema,
    'auth.confirm': confirmSchema,
  },
  fieldTypes: ['auth.emailField'],
  componentTypes: {
    confirmOperation: ConfirmOperationNode,
    'auth.emailField': EmailFieldNode,
  },
  i18n: authTranslations,
  onInit: () => registerAuthHandlers(),
};
