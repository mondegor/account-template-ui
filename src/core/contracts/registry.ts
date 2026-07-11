import type { ContractKey, ContractRegistry } from './types';

/**
 * Реализация contract-registry. Дубль ключа → fail-fast (владелец возможности один).
 * createContractRegistry() — для изоляции в тестах; contractRegistry — общий инстанс приложения.
 */
export function createContractRegistry(): ContractRegistry {
  const impls = new Map<string, unknown>();
  return {
    provide<T>(key: ContractKey<T>, impl: T): void {
      if (impls.has(key.id)) {
        throw new Error(`contractRegistry: контракт "${key.id}" уже опубликован`);
      }
      impls.set(key.id, impl);
    },
    get<T>(key: ContractKey<T>): T | undefined {
      return impls.get(key.id) as T | undefined;
    },
  };
}

export const contractRegistry: ContractRegistry = createContractRegistry();
