export { authClient } from './httpClient';
export { commonHeaders } from './commonHeaders';
export {
  ApiFieldError,
  ApiProblemError,
  ApiTransportError,
  normalizeError,
  type ApiError,
} from './errors';
export type {
  ErrorAttribute,
  Error400Body,
  ConfirmOperationState,
  OperationError400Body,
  ErrorDetailsBody,
} from './types';
