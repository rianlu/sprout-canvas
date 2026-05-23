import { useCallback, useEffect, useState } from 'react';
import { getServerConfig } from '../lib/api/config';
import type { ServerConfig } from '../types/provider';

export function useProviders(enabled: boolean) {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [providerId, setProviderId] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setError('');
      const data = await getServerConfig();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [enabled]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectedProvider = providerId ? config?.providers.find((provider) => provider.id === providerId) : null;
  const defaultProvider = config?.providers.find((provider) => provider.id === config.defaultImageProvider) || config?.providers[0] || null;
  return { config, providerId, setProviderId, selectedProvider, defaultProvider, error, refresh };
}
