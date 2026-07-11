/**
 * Typed contract-registry: модуль публикует возможность под типизированным ключом, потребитель
 * получает её через ядро по интерфейсу-контракту, не импортируя модуль (plan.txt §«Contract-registry»).
 * Шина событий (fire-and-forget) — отложена до первого потребителя.
 */

/** Типизированный ключ контракта. Фантомный тип T связывает ключ с типом реализации. */
export interface ContractKey<T> {
  readonly id: string;
  /** только для вывода типа, в рантайме не используется */
  readonly __type?: (value: T) => void;
}

/** Объявить ключ контракта (id — уникален глобально). */
export function defineContract<T>(id: string): ContractKey<T> {
  return { id };
}

export interface ContractRegistry {
  provide<T>(key: ContractKey<T>, impl: T): void;
  get<T>(key: ContractKey<T>): T | undefined;
}
