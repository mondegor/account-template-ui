import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n, setLanguage } from '@core/i18n';
import { resetComponents, type SchemaNode } from '@core/schema';
import { registerBaseComponents } from './baseNodes';
import { SchemaRenderer } from './SchemaRenderer';

beforeAll(() => {
  setLanguage('ru');
  initI18n();
  resetComponents();
  registerBaseComponents();
});

describe('SchemaRenderer', () => {
  it('рекурсивно рендерит базовые узлы page/text', () => {
    const schema: SchemaNode = {
      id: 'demo',
      type: 'page',
      title: 'auth.signup.title',
      children: [{ type: 'text', text: 'common.validation.required' }],
    };
    render(<SchemaRenderer schema={schema} />);
    expect(screen.getByTestId('ui-page')).toBeInTheDocument();
    // text-узел резолвит i18n-ключ (common зарегистрирован ядром).
    expect(screen.getByTestId('ui-text')).toHaveTextContent('Обязательное поле');
  });

  it('fail-closed: незарегистрированный тип не рушит рендер, соседний узел рисуется', () => {
    // confirmOperation валиден в схеме, но в этом тесте не зарегистрирован (модуль auth не поднят).
    const schema: SchemaNode = {
      id: 'demo',
      type: 'page',
      children: [{ type: 'text', text: 'common.validation.email' }, { type: 'confirmOperation' }],
    };
    expect(() => render(<SchemaRenderer schema={schema} />)).not.toThrow();
    expect(screen.getByTestId('ui-text')).toBeInTheDocument();
  });
});
