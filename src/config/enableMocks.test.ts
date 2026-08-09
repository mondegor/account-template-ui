import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Спека дефолта VITE_ENABLE_MOCKS. Флаг решает, поднимется ли MSW (единственный потребитель —
 * bootstrap в main.tsx), и без дефолта шаблон после клона встречает 404 на всех формах: `.env`
 * в репозитории нет, а `.env.example` vite не читает.
 *
 * Контракт: не задан — берём режим сборки (в деве включено, в проде нет); '1' включает явно;
 * '0' явно выключает, это рабочий режим против живого бэкенда. Включение здесь — про dev-сборку:
 * bootstrap гейтит msw ещё и по import.meta.env.DEV, чтобы вырезать его из прод-бандла, так что
 * в проде '1' не поднимет моки.
 *
 * config вычисляется на уровне модуля, поэтому каждый случай требует resetModules + динамический
 * импорт: статический зафиксировал бы значение до подмены env.
 */
async function loadConfig() {
  vi.resetModules();
  const { config } = await import('./index');
  return config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('config.enableMocks', () => {
  it('flag unset: mocks follow the build mode (dev)', async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', undefined);
    vi.stubEnv('DEV', true);

    expect((await loadConfig()).enableMocks).toBe(true);
  });

  it('flag unset, production build: mocks are off', async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', undefined);
    vi.stubEnv('DEV', false);

    expect((await loadConfig()).enableMocks).toBe(false);
  });

  it("'1' turns them on explicitly", async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', '1');
    // DEV гасим: иначе обе ветки тернарника дают true и кейс не отличает явный флаг от дефолта.
    vi.stubEnv('DEV', false);

    expect((await loadConfig()).enableMocks).toBe(true);
  });

  it("'0' turns them off explicitly: running against a live backend", async () => {
    vi.stubEnv('VITE_ENABLE_MOCKS', '0');
    vi.stubEnv('DEV', true);

    expect((await loadConfig()).enableMocks).toBe(false);
  });
});
