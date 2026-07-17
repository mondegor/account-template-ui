import { Box } from '@mui/material';

/**
 * Инлайн-иконки auth-модуля (сессии, заголовки карточек профиля). Пакета иконок в проекте нет —
 * тот же приём и line-стиль, что у глифов AppShell. `currentColor` → цвет берётся от MUI
 * (color="error" работает сам, как и sx={{ color: 'primary.main' }} на обёртке).
 */

function Glyph({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: size, height: size, display: 'block' }}
    >
      {children}
    </Box>
  );
}

/** Кнопка питания — массовое завершение сессий (нейтральный «погасить», без агрессии черепа). */
export function PowerIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M12 2v10" />
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    </Glyph>
  );
}

/** Корзина — закрытие одной сессии. */
export function TrashIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </Glyph>
  );
}

/** Фигурка человека — личные данные пользователя. */
export function UserIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Glyph>
  );
}

/** Портфель — кабинет (реалм) пользователя; одинаков для всех реалмов. */
export function BriefcaseIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="2" y="7" width="20" height="14" rx="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </Glyph>
  );
}

/** Щит — блок безопасности. */
export function ShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </Glyph>
  );
}

/** Конверт — строка email. */
export function MailIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 6-10 7L2 6" />
    </Glyph>
  );
}

/** Трубка — строка телефона. */
export function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </Glyph>
  );
}

/** Глобус — строка языка. */
export function GlobeIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Glyph>
  );
}

/** Ярлык — строка типа аккаунта. */
export function TagIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </Glyph>
  );
}

/** Календарь — строка даты регистрации. */
export function CalendarIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </Glyph>
  );
}

/** Узлы сети — строка IP-адреса сессии. */
export function NetworkIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <rect x="16" y="16" width="6" height="6" rx="1" />
      <rect x="2" y="16" width="6" height="6" rx="1" />
      <rect x="9" y="2" width="6" height="6" rx="1" />
      <path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" />
      <path d="M12 12V8" />
    </Glyph>
  );
}

/** Булавка на карте — строка локации последнего входа. */
export function MapPinIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </Glyph>
  );
}

/** Песочные часы — строка протухания сессии. */
export function HourglassIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M5 22h14" />
      <path d="M5 2h14" />
      <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
      <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
    </Glyph>
  );
}

/** Часы — строка последнего входа. */
export function ClockIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Glyph>
  );
}
