export function formatBytes(bytes: number) {
  const kb = bytes / 1024;
  return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(1)} KB`;
}

export function resultDataUrl(result: { data?: Array<{ b64_json?: string; url?: string }> }) {
  const item = result.data?.[0];
  return item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || '';
}
