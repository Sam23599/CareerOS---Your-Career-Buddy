export async function sourceText(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000), redirect: 'error', headers: { Accept: 'application/json, text/html', 'User-Agent': 'CareerOS/0.1 (public career source reader)' } });
  if (!response.ok || !response.body) throw new Error('Career source is unavailable.');
  const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 20 * 1024 * 1024) throw new Error('Source response too large.'); chunks.push(value); } }
  finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
