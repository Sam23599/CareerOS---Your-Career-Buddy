import { useEffect, useState } from 'react';

type Provider = { id: string; name: string; url: string };
const supportedProviders = [{ id: 'google', name: 'Google' }, { id: 'github', name: 'GitHub' }];

export function OAuthButtons() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/auth/providers', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => {
        if (!response.ok) throw new Error('Provider lookup failed');
        const body = await response.json();
        if (!controller.signal.aborted) setProviders(body.providers);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, []);

  const unavailable = supportedProviders.filter(provider => !providers?.some(enabled => enabled.id === provider.id));
  const message = failed ? 'Could not check sign-in options. Refresh the page or use email.'
    : providers === null ? 'Checking sign-in options…'
    : unavailable.length ? `${unavailable.map(provider => provider.name).join(' and ')} sign-in is not available yet. You can use email below.`
    : '';

  return <div className="oauth-options">
    {supportedProviders.map(provider => {
      const enabled = providers?.find(value => value.id === provider.id);
      return enabled
        ? <a className="oauth-button" key={provider.id} href={enabled.url}>Continue with {provider.name}</a>
        : <button className="oauth-button" type="button" key={provider.id} disabled aria-describedby="oauth-availability">Continue with {provider.name}</button>;
    })}
    {message && <p id="oauth-availability" className="muted" role="status">{message}</p>}
    <p className="muted">or use your email</p>
  </div>;
}
