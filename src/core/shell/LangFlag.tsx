import { useId, type ReactNode } from 'react';
import { Box } from '@mui/material';

/**
 * Инлайн-SVG флаг языка (emoji-флаги на Windows не рендерятся как флаги). SVG обёрнут в квадрат
 * 20×20 — чтобы в топ-баре содержимое кнопки было той же формы, что у значков темы/выхода (единый
 * круглый hover). Переиспользуется в профиле (строка «Язык»).
 *
 * `lang` — код языка из справочника (@core/i18n). Флаги живут кодом, а не в json: рисовать их
 * нечем, кроме SVG. Для языка без флага возвращаем null — лучше пусто, чем чужой флаг.
 */
export function LangFlag({ lang }: { lang: string }) {
  // Уникальный id паттерна — иначе при двух флагах на странице (топбар + профиль) дубли id в DOM.
  const starsId = `${useId()}-stars`;
  const sx = { width: 18, height: 12, borderRadius: '2px', display: 'block', flexShrink: 0 };
  if (lang === 'ru') {
    return (
      <FlagBox>
        <Box component="svg" viewBox="0 0 3 2" sx={sx}>
          <rect width="3" height="2" fill="#fff" />
          <rect width="3" height="1.333" y="0.667" fill="#0039a6" />
          <rect width="3" height="0.667" y="1.333" fill="#d52b1e" />
        </Box>
      </FlagBox>
    );
  }
  if (lang === 'en') {
    return (
      <FlagBox>
        {/* Флаг США: пропорция 1.9:1 растянута на ту же плашку 3:2, что у остальных флагов.
            Звёзды на крыже шириной ~7px неразличимы — вместо них сетка белых точек. */}
        <Box component="svg" viewBox="0 0 19 10" preserveAspectRatio="none" sx={sx}>
          <defs>
            <pattern id={starsId} width="1.267" height="0.897" patternUnits="userSpaceOnUse">
              <circle cx="0.633" cy="0.449" r="0.2" fill="#fff" />
            </pattern>
          </defs>
          <rect width="19" height="10" fill="#b22234" />
          <path
            d="M0,1.154 h19 M0,2.692 h19 M0,4.231 h19 M0,5.769 h19 M0,7.308 h19 M0,8.846 h19"
            stroke="#fff"
            strokeWidth="0.769"
          />
          <rect width="7.6" height="5.385" fill="#3c3b6e" />
          <rect width="7.6" height="5.385" fill={`url(#${starsId})`} />
        </Box>
      </FlagBox>
    );
  }
  return null;
}

/** Квадрат 20×20 вокруг флага — общая форма для кнопок топ-бара. */
function FlagBox({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        width: 20,
        height: 20,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </Box>
  );
}
