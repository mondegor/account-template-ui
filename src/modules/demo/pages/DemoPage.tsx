import { Box } from '@mui/material';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';
import { AppShell } from '@core/shell';

/** Демо-страница — тонкая обёртка: рендерит схему demo.home внутри каркаса AppShell. */
export function DemoPage() {
  return (
    <AppShell>
      <Box sx={{ maxWidth: 880, mx: 'auto' }}>
        <SchemaRenderer schema={loadSchema('demo.home')} />
      </Box>
    </AppShell>
  );
}
