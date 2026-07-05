import { getCorrelationId } from './correlationId';
import { getLanguage } from '@core/i18n';

/** Заголовки, которые фронт шлёт во ВСЕ запросы (см. память [[request-headers]]). */
export function commonHeaders(): Record<string, string> {
  return {
    'Accept-Language': getLanguage(),
    'X-Correlation-Id': getCorrelationId(),
  };
}
