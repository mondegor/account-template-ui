import { useMemo, useState, type ReactNode } from 'react';
import {
  AppBar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { buildNav } from '@core/module-registry';
import { logout, useAuthStore } from '@core/auth';
import { isEnglish, setLanguage } from '@core/i18n';
import { useThemeMode } from './themeMode';
import { LangFlag } from './LangFlag';

const DRAWER_WIDTH = 240;

/** Компактный брендовый знак (line-принтер) для топ-бара shell. */
function ShellBrand() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box
        component="svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        sx={{ width: 20, height: 20, color: 'primary.main', display: 'block', flexShrink: 0 }}
      >
        <path d="M6 9V3h12v6" />
        <path d="M6 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-1" />
        <rect x="6" y="14" width="12" height="7" rx="1" />
      </Box>
      <Typography
        variant="overline"
        sx={{ fontWeight: 700, letterSpacing: '.12em', color: 'text.secondary', lineHeight: 1 }}
      >
        PRINT·SHOP
      </Typography>
    </Box>
  );
}

/** Инлайн-бургер (без @mui/icons-material) — три линии. */
function MenuGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      sx={{ width: 22, height: 22, display: 'block' }}
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Box>
  );
}

/** Line-значки (Feather-стиль, stroke currentColor) для сегментов темы. */
function SunGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 20, height: 20, display: 'block' }}
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Box>
  );
}

function MoonGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 20, height: 20, display: 'block' }}
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Box>
  );
}

/** «Авто/система» — монитор с подставкой (тот же line-стиль). */
function AutoGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 20, height: 20, display: 'block' }}
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </Box>
  );
}

const THEME_OPTIONS = [
  { value: 'light', glyph: <SunGlyph /> },
  { value: 'dark', glyph: <MoonGlyph /> },
  { value: 'system', glyph: <AutoGlyph /> },
] as const;

/** Переключатель темы: один значок текущего режима, клик циклически меняет (авто→светлая→тёмная→…,
 *  порядок из CYCLE в themeMode.ts). */
function ThemeButton() {
  const { t } = useTranslation();
  const mode = useThemeMode((s) => s.mode);
  const cycleMode = useThemeMode((s) => s.cycleMode);
  const glyph = THEME_OPTIONS.find((o) => o.value === mode)?.glyph;
  return (
    <Tooltip title={t(`common.shell.theme.${mode}`)}>
      <IconButton
        size="small"
        color="inherit"
        aria-label={t(`common.shell.theme.${mode}`)}
        onClick={cycleMode}
      >
        {glyph}
      </IconButton>
    </Tooltip>
  );
}

/** Значок выхода (Feather log-out, стрелка влево из двери) — line-стиль. */
function LogOutGlyph() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      sx={{ width: 20, height: 20, display: 'block' }}
    >
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <polyline points="9 7 4 12 9 17" />
      <line x1="4" y1="12" x2="16" y2="12" />
    </Box>
  );
}

const LANG_NAME: Record<'ru' | 'en', string> = { ru: 'Русский', en: 'English' };

/** Переключатель языка ru⇄en: только флаг + тултип; клик — смена языка (провайдер + i18next). */
function LanguageButton() {
  const { i18n } = useTranslation();
  const current = isEnglish(i18n.language ?? '') ? 'en' : 'ru';
  const toggle = () => {
    const next = current === 'ru' ? 'en' : 'ru';
    setLanguage(next);
    void i18n.changeLanguage(next);
  };
  return (
    <Tooltip title={LANG_NAME[current]}>
      <IconButton size="small" color="inherit" onClick={toggle} aria-label={LANG_NAME[current]}>
        <LangFlag lang={current} />
      </IconButton>
    </Tooltip>
  );
}

/** Список пунктов навигации из реестра (buildNav — уже отфильтрован по ролям). */
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  // Реестр модулей статичен после бутстрапа (роли пока не реактивны) — считаем список один раз,
  // а не на каждый ре-рендер оболочки (смена темы/языка, открытие мобильного меню).
  const items = useMemo(() => buildNav(), []);
  return (
    <List>
      {items.map((item) => {
        const route = item.route ?? item.children?.[0]?.route;
        return (
          <ListItemButton
            key={item.id}
            component={Link}
            to={route ?? '#'}
            selected={route === location.pathname}
            onClick={onNavigate}
          >
            <ListItemText primary={t(item.label)} />
          </ListItemButton>
        );
      })}
    </List>
  );
}

/**
 * Каркасная оболочка приложения (layout-компонент): топ-бар (бренд + тема/язык + выход) и
 * боковое меню из реестра модулей. Десктоп — постоянный Drawer, мобайл — временный по бургеру.
 * Страница сама заворачивается в <AppShell> (как auth-экраны в <AuthLayout>) — реестр/роутер
 * про оболочку не знают. Живёт в core (доменно-агностична, ведома реестром); полный иконочный
 * рейл с подменю — будущий шаг (контракт NavItem тот же).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();
  const status = useAuthStore((s) => s.status);
  // Выход блокирует свою же кнопку: двойной клик слал бы второй DELETE /v1/session. По успеху кнопка
  // и так исчезает (status → anonymous), сброс важен лишь на ошибке — тогда её можно нажать снова.
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = () => {
    if (loggingOut) return;
    setLoggingOut(true);
    void logout().finally(() => setLoggingOut(false));
  };

  const drawerContent = (
    <Box>
      <Toolbar>
        <ShellBrand />
      </Toolbar>
      <Divider />
      <NavList onNavigate={isMobile ? () => setMobileOpen(false) : undefined} />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        color="default"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', zIndex: (t2) => t2.zIndex.drawer + 1 }}
      >
        <Toolbar sx={{ gap: 1 }}>
          {isMobile && (
            <IconButton
              edge="start"
              color="inherit"
              aria-label={t('common.shell.menu')}
              onClick={() => setMobileOpen(true)}
            >
              <MenuGlyph />
            </IconButton>
          )}
          {!isMobile && <ShellBrand />}
          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" alignItems="center" spacing={1}>
            <ThemeButton />
            <LanguageButton />
            {status === 'authenticated' && (
              <Tooltip title={t('common.shell.logout')}>
                <IconButton
                  size="small"
                  color="inherit"
                  aria-label={t('common.shell.logout')}
                  disabled={loggingOut}
                  onClick={handleLogout}
                >
                  <LogOutGlyph />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Toolbar>
      </AppBar>

      {/* Боковое меню: десктоп — постоянное, мобайл — временный Drawer по бургеру. */}
      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        {isMobile ? (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
          >
            {drawerContent}
          </Drawer>
        ) : (
          <Drawer
            variant="permanent"
            open
            sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
          >
            {drawerContent}
          </Drawer>
        )}
      </Box>

      <Box
        component="main"
        sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, minWidth: 0 }}
      >
        <Toolbar />
        <Box sx={{ p: 3 }}>{children}</Box>
      </Box>
    </Box>
  );
}
