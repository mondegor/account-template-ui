import { beforeEach, describe, expect, it } from 'vitest';
import { forceLogout } from '@core/auth';
import { useOperationStore } from '@core/operation';
import { initAuthModule } from './register';
import { loadSecurityFlow, saveSecurityFlow } from './lib/securityFlow';
import { setRecoveryCodes, getRecoveryCodes } from './lib/recoveryCodes';

/**
 * Принудительный разлогин вкладку не перезагружает, поэтому всё состояние ушедшего пользователя
 * обязано уйти вместе с сессией. Операция подтверждения и признак security-потока живут в
 * sessionStorage и сами по себе смены пользователя не переживают только потому, что на разлогин
 * подписан модуль auth: без подписки следующий гость в этой вкладке получил бы чужое
 * подтверждение — движок возобновляет операцию при старте, а /confirm рисует её как свою.
 */

beforeEach(() => {
  sessionStorage.clear();
  useOperationStore.getState().reset();
});

describe('the auth module: cleanup on a forced sign-out', () => {
  it('the operation snapshot, the flow marker and the recovery codes leave together with the session', () => {
    initAuthModule();
    useOperationStore.getState().dispatch({
      type: 'START',
      parts: {
        token: 't'.repeat(64),
        confirm_method: 'EMAIL',
        remaining_attempts: 3,
        expires_in: 600,
      },
      now: Date.now(),
    });
    saveSecurityFlow({ kind: 'disable2fa' });
    setRecoveryCodes(['RECOVRY1-CODE0011']);

    forceLogout();

    expect(useOperationStore.getState().snapshot).toBeNull();
    // Персист снимка чистится вместе с ним — иначе операция вернулась бы на первом же reload.
    expect(sessionStorage.getItem('auth:operation')).toBeNull();
    expect(loadSecurityFlow()).toBeNull();
    // Коды в storage не лежат, но память вкладки разлогин переживает — гасим и её.
    expect(getRecoveryCodes()).toBeNull();
  });
});
