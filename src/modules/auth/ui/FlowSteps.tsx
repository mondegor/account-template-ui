import { Box, Typography } from '@mui/material';
import { CheckIcon } from './icons';

export interface FlowStep {
  label: string;
  state: 'done' | 'current' | 'todo';
}

/**
 * Ступени потока, в котором несколько подтверждений идут на разные адреса: смена емаила — код с
 * текущего, затем код с нового. Ступень считает адрес (или вид доказательства), а не звено: код с
 * емаила и пароль второго фактора — одна ступень «текущий емаил».
 *
 * Список нумерованный и для экранного диктора: текущая ступень помечена `aria-current="step"`,
 * пройденная несёт галочку вместо номера — цвет здесь не единственный носитель смысла.
 */
export function FlowSteps({ steps }: { steps: FlowStep[] }) {
  return (
    <Box
      component="ol"
      sx={{
        listStyle: 'none',
        p: 0,
        m: 0,
        mb: 1.5,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        rowGap: 0.5,
      }}
    >
      {steps.map((step, i) => (
        <Box
          component="li"
          key={step.label}
          aria-current={step.state === 'current' ? 'step' : undefined}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
        >
          {/* Черта между ступенями — оформление, её место в самом пункте: у списка нет «между». */}
          {i > 0 && (
            <Box aria-hidden sx={{ width: 20, height: '1px', bgcolor: 'divider', flexShrink: 0 }} />
          )}
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              fontSize: 11.5,
              fontWeight: 700,
              border: 1,
              ...(step.state === 'current'
                ? {
                    bgcolor: 'primary.main',
                    borderColor: 'primary.main',
                    color: 'primary.contrastText',
                  }
                : step.state === 'done'
                  ? { borderColor: 'success.main', color: 'success.main' }
                  : { borderColor: 'divider', color: 'text.secondary' }),
            }}
          >
            {step.state === 'done' ? <CheckIcon size={12} /> : i + 1}
          </Box>
          <Typography
            variant="caption"
            sx={{
              fontSize: 12.5,
              color: step.state === 'current' ? 'text.primary' : 'text.secondary',
              fontWeight: step.state === 'current' ? 600 : 400,
            }}
          >
            {step.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
