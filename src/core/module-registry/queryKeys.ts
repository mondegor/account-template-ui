/**
 * Конвенция ключей TanStack Query: [moduleId, entity, ...params] (plan.txt §«Кэш TanStack Query»).
 * Единый общий QueryClient; кросс-инвалидация между модулями — через contract-registry (позже).
 */
export function moduleQueryKey(
  moduleId: string,
  entity: string,
  ...params: unknown[]
): [string, string, ...unknown[]] {
  return [moduleId, entity, ...params];
}
