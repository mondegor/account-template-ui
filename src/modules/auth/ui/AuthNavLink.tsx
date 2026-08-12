import { useNavigate } from 'react-router';
import { Link } from '@mui/material';

/**
 * Ссылка-переход в футере публичных auth-экранов (регистрация ↔ вход ↔ резервный вход). Кнопка, а
 * не якорь: переход идёт через роутер, а не перезагрузкой. Оформление держим здесь, чтобы строки
 * футера на всех трёх экранах выглядели одинаково.
 */
export function AuthNavLink({ to, children }: { to: string; children: string }) {
  const navigate = useNavigate();
  return (
    <Link
      component="button"
      type="button"
      onClick={() => navigate(to)}
      sx={{ verticalAlign: 'baseline', fontSize: 'inherit', lineHeight: 'inherit', p: 0 }}
    >
      {children}
    </Link>
  );
}
