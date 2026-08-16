import { ShieldCheckIcon, ShieldDotsIcon, ShieldOffIcon } from './icons';
import type { UserAuth2fa } from '../api/types';

/**
 * Ступень лестницы защиты: тон и щит. Одна таблица на приложение — состояние `auth_2fa_type` метят
 * двое, полоса на профиле и карточка настроек, и разойдись они, один и тот же аккаунт выглядел бы
 * на двух экранах по-разному.
 *
 * Тон семантический, своих цветов ни один из них не заводит: всё берётся из `theme.palette`.
 * Выключенная 2FA — незанятая ступень, а не поломка, поэтому тон у неё нейтральный, брендовый;
 * `info` тут не подходит — в MUI он голубой и с синим темы не совпадает.
 */
export const TWO_FA_LADDER: Record<
  UserAuth2fa,
  { tone: 'primary' | 'warning' | 'success'; Shield: typeof ShieldOffIcon }
> = {
  NONE: { tone: 'primary', Shield: ShieldOffIcon },
  PASSWORD: { tone: 'warning', Shield: ShieldDotsIcon },
  TOTP: { tone: 'success', Shield: ShieldCheckIcon },
};
