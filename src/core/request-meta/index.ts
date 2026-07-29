/**
 * Метаданные исходящего запроса: то, что фронт досылает к нему, вычислив из клиентского
 * состояния, — заголовки трассировки и окно применённых настроек.
 *
 * Пакет намеренно ничего не знает ни про auth, ни про axios-клиент: считать эти значения нужно и
 * тому, кто отправляет запрос через authClient (интерсептор `@core/api`), и тому, кто ходит мимо
 * него собственным клиентом (продление и закрытие сессии в `@core/auth`). Поэтому слой лежит ниже
 * обоих — тянуть его может кто угодно.
 */
export { commonHeaders } from './commonHeaders';
export {
  setSettingsOverride,
  getSettingsOverride,
  clearSettingsOverride,
  type SettingsOverride,
} from './settingsOverride';
