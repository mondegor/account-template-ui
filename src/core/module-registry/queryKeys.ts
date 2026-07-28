/**
 * Конвенция ключей TanStack Query: [moduleId, entity, ...params].
 * Единый общий QueryClient; кросс-инвалидация между модулями — через contract-registry (позже).
 */
export function moduleQueryKey(
  moduleId: string,
  entity: string,
  ...params: unknown[]
): [string, string, ...unknown[]] {
  return [moduleId, entity, ...params];
}
