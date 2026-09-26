import { useEffect, useRef, useState } from 'react';
import { limits } from '@config';
import { calcPasswordStrength } from '../api/authApi';
import type { CalcPasswordStrengthResponse } from '../api/types';

/**
 * Живая оценка набираемого пароля. Считает её сервер, а хук отвечает за то, когда спрашивать и чей
 * ответ применять.
 *
 * Пауза в наборе — как у живой проверки емаила: без неё ручка дёргалась бы на каждый символ. Ответ
 * применяется только к тому значению, ради которого его спрашивали, — уборка эффекта гасит
 * предыдущий запрос, и выигрывает последнее набранное.
 *
 * Явный повтор паузы не ждёт: она отделяет набор от запроса, а нажатую кнопку отделять не от чего —
 * с паузой та почти секунду выглядела бы несработавшей.
 *
 * У значения бывает известная оценка (`assume`) — тогда сервер не спрашивают вовсе: спрашивать про
 * значение, выданное самой системой, значит спрашивать её же о её работе.
 */

/** Через сколько мс после остановки печати спрашиваем оценку. */
const CHECK_DEBOUNCE_MS = 700;

export type PasswordStrengthState =
  /** Короче минимума: метод на таком значении отвечает 400, и спрашивать его незачем. */
  | { kind: 'short' }
  /** Ответа ещё нет — пауза в наборе либо запрос в пути. */
  | { kind: 'checking' }
  /** Оценку получить не удалось: шкала останется пустой, а рядом встанет повтор. */
  | { kind: 'failed' }
  /** Оценка сервера: ступень для шкалы и `acceptable` — пропустит ли пароль установка. */
  | ({ kind: 'rated' } & CalcPasswordStrengthResponse);

export function usePasswordStrength(password: string): {
  state: PasswordStrengthState;
  /** Спросить заново — после отказа. */
  retry: () => void;
  /**
   * Оценка этого значения известна заранее — запроса по нему не будет. Значение хранится вместе с
   * оценкой: правка поля уводит от него, и набранное руками оценивает уже сервер.
   */
  assume: (value: string, rating: CalcPasswordStrengthResponse) => void;
} {
  const [state, setState] = useState<PasswordStrengthState>({ kind: 'short' });
  // Счётчик повторов входит в зависимости эффекта: значение при повторе то же самое, и без него
  // эффект не перезапустился бы.
  const [attempt, setAttempt] = useState(0);
  // Этот прогон эффекта начат кнопкой повтора. Признак разовый — гасится тем же прогоном, который
  // его прочитал, иначе набранное после повтора уходило бы на сервер без паузы.
  const immediate = useRef(false);
  /** Значение с уже известной оценкой — см. `assume`. */
  const known = useRef<{ value: string; rating: CalcPasswordStrengthResponse }>(undefined);

  useEffect(() => {
    if (password.length < limits.password.min) {
      setState({ kind: 'short' });
      return;
    }
    // Оценка известна — спрашивать нечего, и «проверяем» на экране не появляется вовсе.
    if (known.current?.value === password) {
      setState({ kind: 'rated', ...known.current.rating });
      return;
    }
    let alive = true;
    const delay = immediate.current ? 0 : CHECK_DEBOUNCE_MS;
    immediate.current = false;
    setState({ kind: 'checking' });
    const timer = setTimeout(() => {
      calcPasswordStrength(password)
        .then((rating) => {
          if (alive) setState({ kind: 'rated', ...rating });
        })
        .catch(() => {
          if (alive) setState({ kind: 'failed' });
        });
    }, delay);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [password, attempt]);

  return {
    state,
    retry: () => {
      immediate.current = true;
      setAttempt((n) => n + 1);
    },
    assume: (value, rating) => {
      known.current = { value, rating };
    },
  };
}
