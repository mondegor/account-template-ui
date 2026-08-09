import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useRoutes } from 'react-router';
import { QueryClient } from '@tanstack/react-query';
import { initI18n, setLanguage } from '@core/i18n';
import { registerBaseComponents } from '@core/renderer';
import { buildRoutes, registerModule, resetRegistry } from '@core/module-registry';
import { resetComponents, resetSchemas } from '@core/schema';
import { realmProvider } from '@core/auth';
import { contractRegistry } from '@core/contracts';
import { demoModule } from './module';
import { tr } from '../../test/i18n';

/**
 * Доказательство расширяемости: демо-модуль подключается через реестр и его роут /demo рендерит
 * schema-страницу — ядро (core/*) при этом не менялось.
 */
function Routed() {
  return useRoutes(buildRoutes());
}

beforeAll(() => {
  setLanguage('en');
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
  it('the /demo route renders the demo.home schema', () => {
    render(
      <MemoryRouter initialEntries={['/demo']}>
        <Routed />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('ui-page')).toHaveTextContent(tr('demo.home.title'));
    expect(screen.getByTestId('ui-text')).toHaveTextContent('demo.home');
  });
});
