import { useEffect, useState } from 'react';
import { authenticatedRequest } from '../auth/session';

export type AiOptions = { model: string; reasoning: string | null };
type Capabilities = { available: boolean; provider: string; models: { id: string; reasoningOptions: string[] }[]; defaultModel: string; defaultReasoning: string | null };
export function useAiSettings(enabled = true) {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null), [options, setOptions] = useState<AiOptions>({ model: '', reasoning: null }), [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void authenticatedRequest<Capabilities>('/intelligence/capabilities', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setCapabilities(value); setOptions({ model: value.defaultModel, reasoning: value.defaultReasoning }); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [enabled]);
  return { capabilities, options, setOptions, error };
}
export function AiSettings({ settings, disabled = false }: { settings: Omit<ReturnType<typeof useAiSettings>, 'setOptions'> & { setOptions: (value: AiOptions) => void }; disabled?: boolean }) {
  const { capabilities, options, setOptions, error } = settings;
  return <div className="ai-settings">
    {error && <p className="form-error" role="alert">{error}</p>}
    {!capabilities && !error && <p role="status">Checking AI availability…</p>}
    {capabilities && !capabilities.available && <p className="extraction-warning">AI generation is unavailable. Check provider and intelligence storage configuration.</p>}
    {capabilities && <div className="profile-grid">
      <label>AI model<select disabled={disabled} value={options.model} onChange={event => {
        const model = capabilities.models.find(item => item.id === event.target.value)!;
        setOptions({ model: model.id, reasoning: model.reasoningOptions.includes('medium') ? 'medium' : model.reasoningOptions[0] ?? null });
      }}>{capabilities.models.map(model => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
      {options.reasoning !== null && <label>Reasoning effort<select disabled={disabled} value={options.reasoning} onChange={event => setOptions({ ...options, reasoning: event.target.value })}>
        {capabilities.models.find(item => item.id === options.model)?.reasoningOptions.map(value => <option key={value} value={value}>{value}</option>)}</select></label>}
    </div>}
    <p className="muted">{capabilities?.provider ?? 'OpenAI'} receives the selected career facts and your request. Contact fields and original PDFs are excluded. Generation may incur provider charges; review suggestions before using them.</p>
  </div>;
}
