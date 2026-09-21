import { useRef, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useOperationStore } from '@core/operation';
import { moduleQueryKey } from '@core/module-registry';
import { applyEmail, applyOperation, applyPassword, applyRecoveryCodes } from '../api/authApi';
import type { WaitingConfirmOperation } from '../api/types';
import {
  clearSecurityFlow,
  loadSecurityFlow,
  saveSecurityFlow,
  type SecurityFlowKind,
} from '../lib/securityFlow';
import { clearRecoveryCodes, setRecoveryCodes } from '../lib/recoveryCodes';
import type { SettingsLocationState } from '../lib/contactResult';
import { useConfirmFlow } from '../hooks/useConfirmFlow';
import { EMAIL_HREF, PHONE_HREF } from '../ui/contactAnchors';
import { FlowSteps, type FlowStep } from '../ui/FlowSteps';
import { OperationConfirm } from '../ui/OperationConfirm';
import { SecurityPage } from '../ui/SecurityPage';
import {
  LifeBuoyIcon,
  MailIcon,
  PhoneIcon,
  ShieldCheckIcon,
  ShieldDotsIcon,
  ShieldOffIcon,
} from '../ui/icons';

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
  terminal?: (token: string) => Promise<WaitingConfirmOperation | void>;
  /**
   * Терминал открывает следующую операцию, а не закрывает поток: так шаг 1 смены емаила
   * (`apply-email`) отдаёт подтверждение нового адреса. Вернувшееся звено подтверждается здесь же,
   * а запись потока переезжает на этот вид — с ним меняются тексты экрана и следующий терминал.
   */
  next?: SecurityFlowKind;
  /** Куда уходит закрытая операция — либо экран, который её применяет. */
  done: string;
  /**
   * Куда уходит брошенная операция. По умолчанию — настройки: отзыв ничего не изменил, и вести
   * человека на экран исхода не на что — там ждут доведённую до конца операцию. У контактных
   * потоков это карточка, с которой смена начиналась: возвращаем к ней, но без итога.
   */
  revoked?: string;
  /** Итог, который настройки покажут в карточке, куда вернулся человек. */
  doneState?: SettingsLocationState;
  /**
   * Операция переживает уход с экрана: сервер держит её долго и отдаёт в профиле, а карточка
   * настроек показывает её и даёт вернуться. Тогда внизу стоит «Ввести позже» вместо отмены:
   * отменять операцию ради того, чтобы уйти, незачем, а отмена у неё и так есть — там, где она
   * ждёт, рядом со своим сроком и адресом. Уходит такой выход туда же, куда и отзыв (`revoked`).
   */
  resumable?: boolean;
  /**
   * Поток начат в настройках, а не в двухфакторной защите: над карточкой — их заголовок. Смена
   * емаила и телефона к 2FA не относится.
   */
  fromSettings?: boolean;
  /**
   * Ступени потока по методу текущего звена: ключи подписей (`auth.security.steps.<key>`) и
   * состояние. Есть только там, где коды идут на разные адреса.
   */
  steps?: (confirmMethod: string) => { key: string; state: FlowStep['state'] }[];
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
 * Шаг 2 смены емаила — подтверждение нового адреса. Общий для обоих путей шага 1, различаются они
 * только ступенями. Применение и меняет адрес аккаунта.
 */
const EMAIL_CONFIRM: SecurityFlowScreen = {
  terminal: (token) => applyOperation({ token }),
  done: EMAIL_HREF,
  doneState: { contactDone: 'email' },
  revoked: EMAIL_HREF,
  resumable: true,
  keys: 'emailConfirm',
  finishErrorKey: 'auth.errors.finishEmailConfirm',
  icon: MailIcon,
  fromSettings: true,
};

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
  // Шаг 1 смены емаила: терминал адрес ещё не меняет, а открывает подтверждение нового — оно и
  // закрывает поток. Звено 2FA, если она включена, входит в ту же первую ступень: ступени считают
  // адреса, а не звенья. Аварийный код вместо второго фактора спека здесь не принимает.
  email: {
    terminal: (token) => applyEmail({ token }),
    next: 'email-confirm',
    done: EMAIL_HREF,
    revoked: EMAIL_HREF,
    keys: 'email',
    finishErrorKey: 'auth.errors.finishEmail',
    icon: MailIcon,
    fromSettings: true,
    steps: () => [
      { key: 'current', state: 'current' },
      { key: 'new', state: 'todo' },
    ],
  },
  // Тот же шаг 1 без письма: второй фактор, затем аварийный код отдельным звеном.
  'email-recovery': {
    terminal: (token) => applyEmail({ token }),
    next: 'email-recovery-confirm',
    done: EMAIL_HREF,
    revoked: EMAIL_HREF,
    keys: 'emailRecovery',
    finishErrorKey: 'auth.errors.finishEmail',
    icon: LifeBuoyIcon,
    fromSettings: true,
    steps: (method) => [
      { key: 'factor', state: method === 'RECOVERY' ? 'done' : 'current' },
      { key: 'recovery', state: method === 'RECOVERY' ? 'current' : 'todo' },
      { key: 'new', state: 'todo' },
    ],
  },
  'email-confirm': {
    ...EMAIL_CONFIRM,
    steps: () => [
      { key: 'current', state: 'done' },
      { key: 'new', state: 'current' },
    ],
  },
  'email-recovery-confirm': {
    ...EMAIL_CONFIRM,
    steps: () => [
      { key: 'factor', state: 'done' },
      { key: 'recovery', state: 'done' },
      { key: 'new', state: 'current' },
    ],
  },
  // Тот же шаг 2, к которому вернулись из профиля. Ступеней нет: каким был шаг 1, запись профиля
  // не говорит, а указатель с чужим путём сказал бы человеку о доказательстве, которого не было.
  'email-confirm-resume': EMAIL_CONFIRM,
  // Код приходит на емаил, а не на новый номер: ступень одна, и указатель ничего не добавил бы.
  phone: {
    terminal: (token) => applyOperation({ token }),
    done: PHONE_HREF,
    doneState: { contactDone: 'phone' },
    revoked: PHONE_HREF,
    keys: 'phone',
    finishErrorKey: 'auth.errors.finishPhone',
    icon: PhoneIcon,
    fromSettings: true,
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

  // Куда уходит страница, оставшаяся без снимка. Запоминается в момент, когда операция перестаёт
  // быть: к рендеру без снимка запись потока уже стёрта, а исход у потоков разный — закрытая
  // операция уводит на свой экран, брошенная возвращает к тому, с чего начинали, и вовсе не
  // начатая — в настройки.
  const exitTo = useRef('/settings');
  const exitState = useRef<SettingsLocationState | undefined>(undefined);

  const flow = useConfirmFlow({
    terminal: async (token) => {
      // Операции без своего потока здесь не бывает: без записи страница уходит отсюда раньше, чем
      // подтверждать становится что-то. Проверка стоит потому, что хук нельзя позвать условно, а
      // отказ выбран вместо тихого пропуска: пропустив терминал, экран объявил бы закрытой
      // операцию, которую никто не применил.
      if (!record || !screen) throw new Error('Security flow is unknown');
      if (screen.terminal) {
        const next = await screen.terminal(token);
        // Терминал открыл следующую операцию: запись переезжает на её вид ДО того, как звено ляжет
        // в стор, — экран перерисуется уже с текстами и терминалом нового шага.
        if (next && screen.next) {
          saveSecurityFlow({ kind: screen.next, value: record.value });
          return next;
        }
        return;
      }
      // Терминала нет — операцию применяет свой экран: кладём ему токен последнего звена. Запись
      // потока при этом остаётся жить: до применения операция не закрыта, а закрыть её нечем, кроме
      // этого токена.
      saveSecurityFlow({ kind: record.kind, token, value: record.value });
    },
    onDone: () => {
      exitTo.current = screen?.done ?? '/settings';
      exitState.current = screen?.doneState;
      // Поток, который применяется дальше, унёс токен в свою запись — гасить её здесь значило бы
      // отобрать у него операцию.
      if (screen?.terminal) clearSecurityFlow();
      if (screen?.revokesRecoveryCodes) clearRecoveryCodes();
      // Сессии и токены завершающие методы не трогают — по спеке достаточно перечитать профиль:
      // из него берут состояние 2FA и остаток аварийных кодов и карточка настроек, и полоса профиля.
      void queryClient.invalidateQueries({ queryKey: moduleQueryKey('auth', 'user') });
      navigate(exitTo.current, { replace: true, state: exitState.current });
    },
    onRevoked: () => {
      clearSecurityFlow();
      // Адрес тот же, что у рендера без снимка: `revoke` гасит снимок до этого вызова, и разойдись
      // они, страница ушла бы по одному из двух наугад. Итога тут нет — отменённая смена не итог.
      exitTo.current = screen?.revoked ?? '/settings';
      exitState.current = undefined;
      navigate(exitTo.current, { replace: true });
    },
    onLeft: () => {
      // Запись описывает открытый экран, а экран закрывается: вернувшись через карточку, человек
      // придёт с новой записью. Операции это не касается — она осталась на сервере и ждёт.
      clearSecurityFlow();
      exitTo.current = screen?.revoked ?? '/settings';
      exitState.current = undefined;
      navigate(exitTo.current, { replace: true });
    },
    finishErrorKey: screen?.finishErrorKey,
  });

  // Операции нет — заходить не на что. Адрес тот же, что у навигации из onDone, и взят прямо из
  // неё: там снимок гаснет раньше перехода, и разойдись они, экран увёл бы человека мимо только
  // что выданных кодов.
  if (!snapshot) return <Navigate to={exitTo.current} replace state={exitState.current} />;
  // Записи нет — операция не наша: вход и регистрацию ведёт /confirm, и уводим мы её туда.
  if (!record) return <Navigate to="/confirm" replace />;

  // Экран берётся из той же таблицы, что и у обработчиков выше, но своим чтением: там запись ещё
  // могла быть пустой, здесь она уже проверена.
  const {
    keys,
    icon: Icon,
    iconTone,
    allowRecoverySwap,
    fromSettings,
    resumable,
    steps,
  } = FLOWS[record.kind];
  const p = (key: string) => t(`auth.security.${keys}.${key}`);

  return (
    // Шапку карточки рисует форма подтверждения, а не схема страницы: там строка заголовка делит
    // место с переключателем формата. Называет она поток — что спрашивают сейчас, говорит подсказка
    // под ней.
    <SecurityPage section={fromSettings ? t('auth.settings.title') : undefined}>
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
        onLeave={resumable ? flow.leave : undefined}
        steps={
          steps && (
            <FlowSteps
              steps={steps(snapshot.confirmMethod).map((s) => ({
                label: t(`auth.security.steps.${s.key}`),
                state: s.state,
              }))}
            />
          )
        }
        hintValues={record.value ? { value: record.value } : undefined}
      />
    </SecurityPage>
  );
}
