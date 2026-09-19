import { useRef, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOperationStore } from '@core/operation';
import { moduleQueryKey } from '@core/module-registry';
import { applyOperation, applyPassword, applyRecoveryCodes } from '../api/authApi';
import {
  clearSecurityFlow,
  loadSecurityFlow,
  saveSecurityFlow,
  type SecurityFlowKind,
} from '../lib/securityFlow';
import { clearRecoveryCodes, setRecoveryCodes } from '../lib/recoveryCodes';
import { useConfirmFlow } from '../hooks/useConfirmFlow';
import { OperationConfirm } from '../ui/OperationConfirm';
import { SecurityPage } from '../ui/SecurityPage';
import { LifeBuoyIcon, ShieldCheckIcon, ShieldDotsIcon, ShieldOffIcon } from '../ui/icons';

/**
 * Подтверждение security-операции. Авторизованный близнец `/confirm`: экран тот же
 * (`OperationConfirm`), а своими у потока остаются терминальное действие, навигация и тексты.
 *
 * Чей это поток, снимок операции не помнит — у него есть токен и метод звена, но не назначение.
 * Говорит об этом запись `securityFlow`, положенная инициатором: её наличие и есть признак
 * security-операции, а её отсутствие — auth-операции, которую ведёт `/confirm`.
 */

interface SecurityFlowScreen {
  /**
   * Завершающий метод потока: токен последнего звена, секрета по спеке он уже не ждёт.
   *
   * Его отсутствие и есть признак потока, который применяется на своём экране (`done`): код с
   * емаила такую операцию только подтверждает, а закрывает её метод, которому нужно доказательство,
   * собираемое там же. Тогда подтверждение передаёт дальше токен последнего звена — больше его
   * взять неоткуда: снимок операции к тому моменту стёрт.
   */
  terminal?: (token: string) => Promise<void>;
  /** Куда уходит закрытая операция — либо экран, который её применяет. */
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
 * Потоки, которые ведёт этот экран, — все до единого: запись с неизвестным видом отсеивает уже
 * `loadSecurityFlow`, поэтому экран под прочитанную запись есть всегда.
 */
const FLOWS: Record<SecurityFlowKind, SecurityFlowScreen> = {
  password: {
    terminal: async (token) => setRecoveryCodes((await applyPassword({ token })).recovery_codes),
    done: '/security/codes',
    keys: 'password',
    finishErrorKey: 'auth.errors.finishPassword',
    icon: ShieldDotsIcon,
  },
  // Единственный поток без терминала: 2FA включает код из приложения, а собирает его экран привязки
  // генератора — туда и уходит подтверждённая операция.
  totp: {
    done: '/security/totp',
    keys: 'totp',
    finishErrorKey: 'auth.errors.finishTotp',
    icon: ShieldCheckIcon,
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
      if (!record || !screen) throw new Error('Security flow is unknown');
      if (screen.terminal) {
        await screen.terminal(token);
        return;
      }
      // Терминала нет — операцию применяет свой экран: кладём ему токен последнего звена. Запись
      // потока при этом остаётся жить: до применения операция не закрыта, а закрыть её нечем, кроме
      // этого токена.
      saveSecurityFlow({ kind: record.kind, token });
    },
    onDone: () => {
      exitTo.current = screen?.done ?? '/settings';
      // Поток, который применяется дальше, унёс токен в свою запись — гасить её здесь значило бы
      // отобрать у него операцию.
      if (screen?.terminal) clearSecurityFlow();
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

  // Экран берётся из той же таблицы, что и у обработчиков выше, но своим чтением: там запись ещё
  // могла быть пустой, здесь она уже проверена.
  const { keys, icon: Icon, iconTone, allowRecoverySwap } = FLOWS[record.kind];
  const p = (key: string) => t(`auth.security.${keys}.${key}`);

  return (
    // Шапку карточки рисует форма подтверждения, а не схема страницы: там строка заголовка делит
    // место с переключателем формата. Называет она поток — что спрашивают сейчас, говорит подсказка
    // под ней.
    <SecurityPage>
      <OperationConfirm
        flow={flow}
        title={p('title')}
        icon={<Icon size={22} />}
        iconTone={iconTone}
        hintPrefix={`auth.security.${keys}.hint`}
        deadEndText={p('deadEnd')}
        awaitingFinishText={p('awaitingFinish')}
        invalidatedText={p('invalidated')}
        allowRecoverySwap={allowRecoverySwap}
      />
    </SecurityPage>
  );
}
