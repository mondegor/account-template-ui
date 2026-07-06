import { Box } from '@mui/material';
import { loadSchema } from '@core/schema';
import { SchemaRenderer } from '@core/renderer';

/** Демо-страница — тонкая обёртка: рендерит схему demo.home. */
export function DemoPage() {
  return (
    <Box sx={{ p: 3, maxWidth: 880, mx: 'auto' }}>
      <SchemaRenderer schema={loadSchema('demo.home')} />
    </Box>
  );
}
