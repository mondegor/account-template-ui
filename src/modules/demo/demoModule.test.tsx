import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { buildRoutes, registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { demoModule } from './module';

/**
 * Доказательство расширяемости: демо-модуль подключается через реестр и его роут /demo рендерит
 * schema-страницу — ядро (core/*) при этом не менялось.
 */
function Routed() {
  return useRoutes(buildRoutes());
}

beforeAll(() => {
  setLanguage('ru');
  initI18n();
  resetRegistry();
  resetComponents();
  resetSchemas();
  registerBaseComponents();
  registerModule(demoModule, {
    queryClient: new QueryClient(),
    contracts: contractRegistry,
    realmProvider,
  });
});

describe('demoModule', () => {
  it('роут /demo рендерит схему demo.home', () => {
    render(
      <MemoryRouter initialEntries={['/demo']}>
        <Routed />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ui-page')).toHaveTextContent('Демо-модуль');
    expect(screen.getByTestId('ui-text')).toHaveTextContent('demo.home');
  });
});
