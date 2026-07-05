import { type Ref } from 'react';
import {
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';

/** Презентационные атомы полей ввода над MUI (плоские пропсы; связь с формой — в адаптерах core). */

export interface UiTextFieldProps {
  label?: string;
  type?: 'text' | 'email' | 'password' | 'tel';
  placeholder?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement>;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
}

export function UiTextField({
  label,
  type = 'text',
  placeholder,
  autoComplete,
  inputMode,
  name,
  value,
  onChange,
  onBlur,
  inputRef,
  error,
  helperText,
  disabled,
  autoFocus,
  maxLength,
}: UiTextFieldProps) {
  return (
    <TextField
      label={label}
      type={type}
      placeholder={placeholder}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      inputRef={inputRef}
      error={error}
      helperText={helperText ?? ' '}
      disabled={disabled}
      autoFocus={autoFocus}
      fullWidth
      size="small"
      slotProps={{ htmlInput: { autoComplete, inputMode, maxLength } }}
      data-testid={name ? `field-${name}` : 'ui-textfield'}
    />
  );
}

export interface UiSelectProps {
  label?: string;
  name?: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}

export function UiSelect({
  label,
  name,
  value,
  options,
  onChange,
  onBlur,
  error,
  helperText,
  disabled,
}: UiSelectProps) {
  const labelId = name ? `${name}-label` : undefined;
  return (
    <FormControl fullWidth size="small" error={error} disabled={disabled}>
      {label && <InputLabel id={labelId}>{label}</InputLabel>}
      <Select
        labelId={labelId}
        label={label}
        name={name}
        value={value}
        onChange={(e) => onChange(String(e.target.value))}
        onBlur={onBlur}
        data-testid={name ? `field-${name}` : 'ui-select'}
      >
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>{helperText ?? ' '}</FormHelperText>
    </FormControl>
  );
}

export interface UiCheckboxProps {
  label?: string;
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onBlur?: () => void;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
}

export function UiCheckbox({
  label,
  name,
  checked,
  onChange,
  onBlur,
  error,
  helperText,
  disabled,
}: UiCheckboxProps) {
  return (
    <FormControl error={error} disabled={disabled}>
      <FormControlLabel
        control={
          <Checkbox
            name={name}
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            onBlur={onBlur}
            data-testid={name ? `field-${name}` : 'ui-checkbox'}
          />
        }
        label={label ?? ''}
      />
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );
}
