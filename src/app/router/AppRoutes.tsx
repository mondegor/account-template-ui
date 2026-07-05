import { Navigate, Route, Routes } from 'react-router-dom';
import { GuestOnly, ProtectedRoute } from '@core/auth';
import { SigninPage, SignupPage, ConfirmPage, ProfilePage } from '@modules/auth';

/**
 * Роуты вертикального среза. Позже соберутся из реестра модулей (module-registry),
 * сейчас — прямой список (bare React).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/signin"
        element={
          <GuestOnly>
            <SigninPage />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <SignupPage />
          </GuestOnly>
        }
      />
      {/* confirm доступен и гостю, и в процессе цепочки — без guard */}
      <Route path="/confirm" element={<ConfirmPage />} />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/signin" replace />} />
    </Routes>
  );
}
