import { AppProviders } from './providers/AppProviders';
import { AppRoutes } from './router/AppRoutes';

export function App() {
  return (
    <AppProviders>
      <AppRoutes />
    </AppProviders>
  );
}
