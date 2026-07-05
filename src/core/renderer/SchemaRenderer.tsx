import { createContext, useContext } from 'react';
import { getComponent, type SchemaNode } from '@core/schema';
import { FormRenderer } from './FormRenderer';

/**
 * Рекурсивный рендер дерева схемы → React. По `type` берёт компонент из componentRegistry; узел
 * `form` — спец-обработка (FormRenderer ставит контекст react-hook-form). Инвариант безопасности
 * (plan.txt): fail-closed на незарегистрированный тип (не рендерим произвольное), запрет
 * dangerouslySetInnerHTML во всём каталоге renderer (ESLint).
 *
 * schemaId (id корневого узла) прокидывается через контекст — FormRenderer по нему берёт обработчик.
 */

const SchemaIdContext = createContext<string | undefined>(undefined);

export function SchemaRenderer({ schema }: { schema: SchemaNode }) {
  return (
    <SchemaIdContext.Provider value={schema.id}>
      <RenderNode node={schema} />
    </SchemaIdContext.Provider>
  );
}

function RenderNode({ node }: { node: SchemaNode }) {
  const schemaId = useContext(SchemaIdContext);
  const children = node.children?.map((child, i) => <RenderNode key={i} node={child} />);

  if (node.type === 'form') {
    return (
      <FormRenderer node={node} schemaId={schemaId}>
        {children}
      </FormRenderer>
    );
  }

  const Component = getComponent(node.type);
  if (!Component) return <UnknownNode type={node.type} />;
  return <Component node={node}>{children}</Component>;
}

/** fail-closed: незарегистрированный тип не рендерим. В dev — видимая подсказка, в prod — ничего. */
function UnknownNode({ type }: { type: string }) {
  if (import.meta.env.DEV) {
    return (
      <span data-testid="unknown-node" role="alert">
        Unknown node type: {type}
      </span>
    );
  }
  return null;
}
