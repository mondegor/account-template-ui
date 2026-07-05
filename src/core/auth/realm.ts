import { config } from '@config';

/**
 * realmProvider: realm-константа деплоя (domain/group). Все auth-запросы берут realm
 * только отсюда — переключателя realm в UI нет. Задел под SaaS-вид (realm из поддомена)
 * меняет только реализацию провайдера, не места вызова. См. память [[realm-model]].
 */
export const realmProvider = {
  getRealm(): string {
    return config.realm;
  },
};
