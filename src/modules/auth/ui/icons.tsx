import { Box } from '@mui/material';

/**
 * Инлайн-иконки страницы сессий. Пакета иконок в проекте нет — тот же приём и line-стиль,
 * что у глифов AppShell. `currentColor` → цвет берётся от MUI (color="error" работает сам).
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

/** Ладонь «стоп» — массовое завершение сессий. */
export function StopHandIcon({ size = 20 }: { size?: number }) {
  return (
    <Glyph size={size}>
      <path d="M18 11V6a2 2 0 0 0-4 0" />
      <path d="M14 10V4a2 2 0 0 0-4 0v2" />
      <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
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
