import { describe, expect, it } from 'vitest';
import { createContractRegistry, defineContract } from './index';

interface Greeter {
  hello(): string;
}
const GREETER = defineContract<Greeter>('demo.greeter');

describe('contract-registry', () => {
  it('provide → get отдаёт типизированную реализацию', () => {
    const r = createContractRegistry();
    r.provide(GREETER, { hello: () => 'hi' });
    expect(r.get(GREETER)?.hello()).toBe('hi');
  });

  it('get неопубликованного контракта → undefined', () => {
    expect(createContractRegistry().get(GREETER)).toBeUndefined();
  });

  it('повторная публикация того же ключа → fail-fast', () => {
    const r = createContractRegistry();
    r.provide(GREETER, { hello: () => 'a' });
    expect(() => r.provide(GREETER, { hello: () => 'b' })).toThrow(/уже опубликован/);
  });
});
