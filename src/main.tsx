import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { config } from '@config';
import { authStore, refresh } from '@core/auth';
import { useOperationStore } from '@core/operation';
import { App } from '@app';

/**
 * Bootstrap: (1) поднять MSW при VITE_ENABLE_MOCKS; (2) возобновить активную операцию из
 * sessionStorage; (3) silent refresh — попытаться восстановить сессию (cookie-mode). Итог:
 * status переходит из 'unknown' в authenticated/anonymous до первого рендера защищённых роутов.
 */
async function bootstrap() {
  if (config.enableMocks) {
    const { worker } = await import('@mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }

  // Возобновить операцию подтверждения (если была активна до reload).
  useOperationStore.getState().hydrate();

  // Silent refresh: при неуспехе refresh() сам вызовет forceLogout → status='anonymous'.
  const ok = await refresh();
  if (!ok) authStore.setAnonymous();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
