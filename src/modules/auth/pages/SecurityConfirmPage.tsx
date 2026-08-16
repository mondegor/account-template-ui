import { useEffect, useRef, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOperationStore } from '@core/operation';
import { moduleQueryKey } from '@core/module-registry';
import { applyOperation, applyPassword, applyRecoveryCodes } from '../api/authApi';
import { clearSecurityFlow, loadSecurityFlow, type SecurityFlowKind } from '../lib/securityFlow';
import { clearRecoveryCodes, setRecoveryCodes } from '../lib/recoveryCodes';
import { useConfirmFlow } from '../hooks/useConfirmFlow';
import { OperationConfirm } from '../ui/OperationConfirm';
import { SecurityPage } from '../ui/SecurityPage';
import { LifeBuoyIcon, ShieldDotsIcon, ShieldOffIcon } from '../ui/icons';

/**
 * Подтверждение security-операции. Авторизованный близнец `/confirm`: экран тот же
 * (`OperationConfirm`), а своими у потока остаются терминальное действие, навигация и тексты.
 *
 * Чей это поток, снимок операции не помнит — у него есть токен и метод звена, но не назначение.
 * Говорит об этом запись `securityFlow`, положенная инициатором: её наличие и есть признак
 * security-операции, а её отсутствие — auth-операции, которую ведёт `/confirm`.
 */

interface SecurityFlowScreen {
  /** Завершающий метод потока: токен последнего звена, секрета по спеке он уже не ждёт. */
  terminal: (token: string) => Promise<void>;
  /** Куда уходит закрытая операция. */
  done: string;
  /** Ветка ключей текстов потока (`auth.security.<...>`) — заголовок, подсказки звеньев, тупики. */
  keys: string;
  /** Запасной текст сорвавшегося терминала: он называет шаг, а шаг у каждого потока свой. */
  finishErrorKey: string;
  icon: (props: { size?: number }) => ReactElement;
  /** Тон глифа; без него глиф идёт брендовым, как метки остальных экранов защиты. */
  iconTone?: 'error';
  /**
   * Аварийный код принимается вместо второго фактора. Спека разрешает это отключению 2FA и
   * запрещает перевыпуску кодов: перевыпуск заменяет сам набор, поэтому требует оба постоянных
   * доказательства — доступ к емаилу и второй фактор.
   */
  allowRecoverySwap?: boolean;
  /**
   * Поток отзывает аварийные коды на сервере. Набор, лежащий в памяти вкладки, после этого
   * нерабочий, а экран показа достижим кнопкой «назад» — гасим набор вместе с потоком.
   */
  revokesRecoveryCodes?: boolean;
}

/**
 * Потоки, которые ведёт этот экран. Установка TOTP-генератора сюда не входит: её терминал
 * спрашивает код из приложения, то есть отдельный экран, которого в шаблоне нет.
 */
const FLOWS: Partial<Record<SecurityFlowKind, SecurityFlowScreen>> = {
  password: {
    terminal: async (token) => setRecoveryCodes((await applyPassword({ token })).recovery_codes),
    done: '/security/codes',
    keys: 'password',
    finishErrorKey: 'auth.errors.finishPassword',
    icon: ShieldDotsIcon,
  },
  'recovery-codes': {
    terminal: async (token) =>
      setRecoveryCodes((await applyRecoveryCodes({ token })).recovery_codes, { reissued: true }),
    done: '/security/codes',
    keys: 'recoveryCodes',
    finishErrorKey: 'auth.errors.finishRecoveryCodes',
    icon: LifeBuoyIcon,
  },
  disable2fa: {
    terminal: (token) => applyOperation({ token }),
    done: '/settings',
    keys: 'disable2fa',
    finishErrorKey: 'auth.errors.finishDisable2fa',
    icon: ShieldOffIcon,
    // Единственный поток, который защиту снимает: цвет отказа отделяет его от установки пароля и
    // перевыпуска кодов, которые её, наоборот, укрепляют.
    iconTone: 'error',
    allowRecoverySwap: true,
    revokesRecoveryCodes: true,
  },
};

export function SecurityConfirmPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshot = useOperationStore((s) => s.snapshot);

  // Запись читается на каждом рендере, а не запоминается: её гасит завершение потока, и держать
  // рядом вторую, свою копию значило бы расходиться с тем, что видит остальное приложение.
  const record = loadSecurityFlow();
  const screen = record ? FLOWS[record.kind] : undefined;

  // Запись есть, а экрана под её поток нет: закрыть операцию нечем, и оставленные лежать запись со
  // снимком встречали бы человека на каждом заходе на подтверждение — /confirm отдавал бы операцию
  // сюда, а мы уводили бы её обратно. Убираем оба, как убирает их брошенный поток; аварийные коды
  // не трогаем — сессия жива, и набор мог быть только что выдан. Эффектом, чтобы рендер не зависел
  // от того, сколько раз его позвали.
  const deadFlow = Boolean(record) && !screen;
  useEffect(() => {
    if (!deadFlow) return;
    clearSecurityFlow();
    useOperationStore.getState().reset();
  }, [deadFlow]);

  // Куда уходит страница, оставшаяся без снимка. Запоминается в момент закрытия операции, потому
  // что к рендеру без снимка запись потока уже стёрта, а исход у потоков разный: закрытая операция
  // уводит на свой экран, брошенная и вовсе не начатая — в настройки.
  const exitTo = useRef('/settings');

  const flow = useConfirmFlow({
    terminal: async (token) => {
      // Операции без своего потока здесь не бывает: без записи страница уходит отсюда раньше, чем
      // подтверждать становится что-то. Проверка стоит потому, что хук нельзя позвать условно, а
      // отказ выбран вместо тихого пропуска: пропустив терминал, экран объявил бы закрытой
      // операцию, которую никто не применил.
      if (!screen) throw new Error('Security flow is unknown');
      await screen.terminal(token);
    },
    onDone: () => {
      exitTo.current = screen?.done ?? '/settings';
      clearSecurityFlow();
      if (screen?.revokesRecoveryCodes) clearRecoveryCodes();
      // Сессии и токены завершающие методы не трогают — по спеке достаточно перечитать профиль:
      // из него берут состояние 2FA и остаток аварийных кодов и карточка настроек, и полоса профиля.
      void queryClient.invalidateQueries({ queryKey: moduleQueryKey('auth', 'user') });
      navigate(exitTo.current, { replace: true });
    },
    onRevoked: () => {
      clearSecurityFlow();
      navigate('/settings', { replace: true });
    },
    finishErrorKey: screen?.finishErrorKey,
  });

  // Операции нет — заходить не на что. Адрес тот же, что у навигации из onDone, и взят прямо из
  // неё: там снимок гаснет раньше перехода, и разойдись они, экран увёл бы человека мимо только
  // что выданных кодов.
  if (!snapshot) return <Navigate to={exitTo.current} replace />;
  // Записи нет — операция не наша: вход и регистрацию ведёт /confirm, и уводим мы её туда.
  if (!record) return <Navigate to="/confirm" replace />;
  // Запись есть, а экрана под её поток нет: вести операцию нечем (её гасит эффект выше).
  if (!screen) return <Navigate to="/settings" replace />;

  const p = (key: string) => t(`auth.security.${screen.keys}.${key}`);

  return (
    // Шапку карточки рисует форма подтверждения, а не схема страницы: там строка заголовка делит
    // место с переключателем формата. Называет она поток — что спрашивают сейчас, говорит подсказка
    // под ней.
    <SecurityPage>
      <OperationConfirm
        flow={flow}
        title={p('title')}
        icon={<screen.icon size={22} />}
        iconTone={screen.iconTone}
        hintPrefix={`auth.security.${screen.keys}.hint`}
        deadEndText={p('deadEnd')}
        awaitingFinishText={p('awaitingFinish')}
        invalidatedText={p('invalidated')}
        allowRecoverySwap={screen.allowRecoverySwap}
      />
    </SecurityPage>
  );
}
