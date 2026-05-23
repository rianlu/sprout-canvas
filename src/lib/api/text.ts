import { apiFetch } from './client';

export function requestTextGeneration(system: string, content: string) {
  return apiFetch<{ text: string; providerName?: string; attempts?: unknown[] }>('/api/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'auto',
      input: [
        { role: 'system', content: [{ type: 'input_text', text: system }] },
        { role: 'user', content: [{ type: 'input_text', text: content }] },
      ],
      stream: false,
    }),
  });
}
