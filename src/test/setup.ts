import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '@mocks/server';

// Собственный лимит ожидания у `findBy*`/`waitFor` — он свой и таймаутом теста НЕ управляется:
// поднятый `timeout` у describe ограничивает кейс целиком, а найти узел RTL всё равно перестаёт
// пробовать через секунду. Страницы поднимают полный MUI-рендер поверх react-query, и при полном
// параллельном прогоне секунды не хватает. Ждём дольше: тесты сторожат поведение, а не скорость,
// и ложное падение на загруженной машине дороже лишних секунд ожидания.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
