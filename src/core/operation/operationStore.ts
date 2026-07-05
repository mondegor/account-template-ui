import { create } from 'zustand';
import { operationReducer, type OperationAction, type OperationSnapshot } from './operationMachine';
import { clearOperation, loadOperation, saveOperation } from './operationPersistence';

/**
 * Хранилище текущей операции подтверждения (одна активная за раз). Диспатч прогоняет
 * generic-reducer и персистит снимок в sessionStorage. hydrate() возобновляет операцию
 * при старте приложения (после reload).
 */
interface OperationStore {
  snapshot: OperationSnapshot | null;
  dispatch: (action: OperationAction) => OperationSnapshot | null;
  hydrate: () => void;
  reset: () => void;
}

export const useOperationStore = create<OperationStore>((set, get) => ({
  snapshot: null,
  dispatch: (action) => {
    const prev = get().snapshot;
    const next = operationReducer(prev, action);
    // Reducer возвращает тот же ref, если ничего не изменилось (напр. no-op TICK) —
    // тогда не пишем в sessionStorage и не триггерим set (иначе ежесекундные setItem/removeItem).
    if (next !== prev) {
      saveOperation(next);
      set({ snapshot: next });
    }
    return next;
  },
  hydrate: () => {
    set({ snapshot: loadOperation(Date.now()) });
  },
  reset: () => {
    clearOperation();
    set({ snapshot: null });
  },
}));
