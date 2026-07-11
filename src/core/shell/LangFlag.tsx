import { useId } from 'react';
import { Box } from '@mui/material';

/**
 * Инлайн-SVG флаг языка (emoji-флаги на Windows не рендерятся как флаги). SVG обёрнут в квадрат
 * 20×20 — чтобы в топ-баре содержимое кнопки было той же формы, что у значков темы/выхода (единый
 * круглый hover). Переиспользуется в профиле (строка «Язык»).
 */
export function LangFlag({ lang }: { lang: 'ru' | 'en' }) {
  // Уникальные id clipPath — иначе при двух флагах на странице (топбар + профиль) дубли id в DOM.
  const rawId = useId();
  const clipS = `${rawId}-s`;
  const clipT = `${rawId}-t`;
  const sx = { width: 18, height: 12, borderRadius: '2px', display: 'block', flexShrink: 0 };
  const flag =
    lang === 'ru' ? (
      <Box component="svg" viewBox="0 0 3 2" sx={sx}>
        <rect width="3" height="2" fill="#fff" />
        <rect width="3" height="1.333" y="0.667" fill="#0039a6" />
        <rect width="3" height="0.667" y="1.333" fill="#d52b1e" />
      </Box>
    ) : (
      // Union Jack (Великобритания) — компактный стандартный путь.
      <Box component="svg" viewBox="0 0 60 30" sx={sx}>
        <clipPath id={clipS}>
          <path d="M0,0 v30 h60 v-30 z" />
        </clipPath>
        <clipPath id={clipT}>
          <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
        </clipPath>
        <g clipPath={`url(#${clipS})`}>
          <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" strokeWidth="6" />
          <path
            d="M0,0 L60,30 M60,0 L0,30"
            clipPath={`url(#${clipT})`}
            stroke="#c8102e"
            strokeWidth="4"
          />
          <path d="M30,0 v30 M0,15 h60" stroke="#fff" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#c8102e" strokeWidth="6" />
        </g>
      </Box>
    );
  return (
    <Box
      sx={{ width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      {flag}
    </Box>
  );
}
