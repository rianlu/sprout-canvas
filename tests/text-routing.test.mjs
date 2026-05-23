import assert from 'node:assert/strict';
import {
  getTextProviderCircuitState,
  isTextProviderCircuitOpen,
  rankedTextProviders,
  recordTextProviderFailure,
  recordTextProviderSuccess,
  resetTextProviderCircuitState,
} from '../server/text-routing.mjs';

const providers = [
  { id: 'text-a', name: '文本 A', textModel: 'gpt-5-mini' },
  { id: 'text-b', name: '文本 B', textModel: 'gpt-5.3' },
];

resetTextProviderCircuitState();
{
  const first = rankedTextProviders(providers).map((provider) => provider.id);
  const second = rankedTextProviders(providers).map((provider) => provider.id);
  assert.deepEqual(first, ['text-a', 'text-b']);
  assert.deepEqual(second, ['text-a', 'text-b']);
}


resetTextProviderCircuitState();
{
  recordTextProviderFailure('text-a', 'temporary failure');
  assert.deepEqual(rankedTextProviders(providers).map((provider) => provider.id), ['text-a', 'text-b']);
}

resetTextProviderCircuitState();
{
  recordTextProviderFailure('text-a', 'first');
  recordTextProviderFailure('text-a', 'second');
  assert.equal(isTextProviderCircuitOpen('text-a'), false);
  recordTextProviderFailure('text-a', 'third');
  assert.equal(isTextProviderCircuitOpen('text-a'), true);
  assert.deepEqual(rankedTextProviders(providers).map((provider) => provider.id), ['text-b']);
  assert.ok(getTextProviderCircuitState('text-a').openUntil > Date.now());
}

resetTextProviderCircuitState();
{
  recordTextProviderFailure('text-a', 'first');
  recordTextProviderFailure('text-a', 'second');
  recordTextProviderSuccess('text-a');
  assert.equal(getTextProviderCircuitState('text-a').failures, 0);
  assert.equal(isTextProviderCircuitOpen('text-a'), false);
}

resetTextProviderCircuitState();
{
  recordTextProviderFailure('text-a', 'first');
  recordTextProviderFailure('text-a', 'second');
  recordTextProviderFailure('text-a', 'third');
  recordTextProviderFailure('text-b', 'first');
  recordTextProviderFailure('text-b', 'second');
  recordTextProviderFailure('text-b', 'third');
  assert.deepEqual(rankedTextProviders(providers), []);
}

console.log('text routing tests passed');
