export { authClient } from './httpClient';
export {
  ApiFieldError,
  ApiProblemError,
  ApiRateLimitError,
  ApiTransportError,
  apiErrorText,
  normalizeError,
  parseErrorCode,
  type ApiError,
} from './errors';
export type {
  ErrorAttribute,
  Error400Body,
  ConfirmOperationState,
  OperationError400Body,
  ErrorDetailsBody,
} from './types';
