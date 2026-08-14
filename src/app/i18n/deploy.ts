/**
 * Переводы уровня деплоя. Realm — константа деплоя (VITE_AUTH_REALM → realmProvider), а значения
 * user_kind бэк задаёт под конкретный проект: имена вида `account-template/admin` не должны лежать в
 * i18n переиспользуемого auth-модуля. Другой деплой правит только этот файл; незнакомый realm или
 * kind модуль покажет как есть (фолбэк в lib/realmLabel.ts).
 *
 * Ветка `deploy.*` подмешивается в общий namespace через addTranslations() — тем же механизмом,
 * которым модули добавляют свои ветки.
 */
export const deployTranslations = {
  ru: {
    deploy: {
      realmLabel: {
        'account-template/standard': 'Клиентский',
        'account-template/admin': 'Служебный',
      },
      userKind: {
        standard: 'Стандартный',
        employee: 'Сотрудник',
      },
    },
  },
  en: {
    deploy: {
      realmLabel: {
        'account-template/standard': 'Client',
        'account-template/admin': 'Admin area',
      },
      userKind: {
        standard: 'Standard',
        employee: 'Employee',
      },
    },
  },
};
