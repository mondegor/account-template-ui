/**
 * Карточки емаила и телефона как цели перехода: на них ставится якорь, по нему страница настроек
 * доводит взгляд до карточки, и туда же возвращает завершённая смена — вместе с итогом.
 */
export const EMAIL_ANCHOR = 'email';
export const PHONE_ANCHOR = 'phone';

export const EMAIL_HREF = `/settings#${EMAIL_ANCHOR}`;
export const PHONE_HREF = `/settings#${PHONE_ANCHOR}`;
