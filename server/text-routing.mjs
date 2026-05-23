const TEXT_PROVIDER_FAILURE_THRESHOLD = 3;
const TEXT_PROVIDER_CIRCUIT_OPEN_MS = 30 * 60 * 1000;

const textProviderCircuitState = new Map();

export function rankedTextProviders(textProviders = []) {
  const providers = Array.isArray(textProviders) ? textProviders.filter(Boolean) : [];
  return providers.filter((provider) => !isTextProviderCircuitOpen(provider.id));
}

export function recordTextProviderSuccess(providerId) {
  if (!providerId) return;
  textProviderCircuitState.set(providerId, { failures: 0, openUntil: 0, lastError: '' });
}

export function recordTextProviderFailure(providerId, error, logLine = null) {
  if (!providerId) return;
  const previous = textProviderCircuitState.get(providerId) || { failures: 0, openUntil: 0, lastError: '' };
  const failures = previous.failures + 1;
  const openUntil = failures >= TEXT_PROVIDER_FAILURE_THRESHOLD ? Date.now() + TEXT_PROVIDER_CIRCUIT_OPEN_MS : previous.openUntil || 0;
  textProviderCircuitState.set(providerId, { failures, openUntil, lastError: String(error || '') });
  if (openUntil && typeof logLine === 'function') {
    logLine('WARN', `[text-provider] circuit-open provider=${providerId} failures=${failures} cooldownMs=${TEXT_PROVIDER_CIRCUIT_OPEN_MS}`);
  }
}

export function isTextProviderCircuitOpen(providerId) {
  const state = textProviderCircuitState.get(providerId);
  if (!state?.openUntil) return false;
  if (state.openUntil > Date.now()) return true;
  textProviderCircuitState.set(providerId, { ...state, openUntil: 0, failures: 0 });
  return false;
}

export function resetTextProviderCircuitState() {
  textProviderCircuitState.clear();
}

export function getTextProviderCircuitState(providerId) {
  return textProviderCircuitState.get(providerId) || { failures: 0, openUntil: 0, lastError: '' };
}
