import { describe, expect, it } from 'vitest';
import { createContractRegistry, defineContract } from './index';

interface Greeter {
  hello(): string;
}
const GREETER = defineContract<Greeter>('demo.greeter');

describe('contract-registry', () => {
  it('provide → get returns the typed implementation', () => {
    const r = createContractRegistry();
    r.provide(GREETER, { hello: () => 'hi' });
    expect(r.get(GREETER)?.hello()).toBe('hi');
  });

  it('get on an unpublished contract returns undefined', () => {
    expect(createContractRegistry().get(GREETER)).toBeUndefined();
  });

  it('publishing the same key twice fails fast', () => {
    const r = createContractRegistry();
    r.provide(GREETER, { hello: () => 'a' });
    expect(() => r.provide(GREETER, { hello: () => 'b' })).toThrow(/already published/);
  });
});
