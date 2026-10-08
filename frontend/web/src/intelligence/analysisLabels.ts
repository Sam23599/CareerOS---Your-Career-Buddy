type AnalysisVersion = { version: number; model: string; reasoning?: string | null; createdAt?: string };

/** Presentation only: source IDs, filenames and saved versions remain unchanged. */
export function analysisVersionLabel(source: string, version: AnalysisVersion) {
  const date = version.createdAt ? new Date(version.createdAt).toLocaleString() : '';
  return [source, `Analysis v${version.version}`, version.model, version.reasoning, date].filter(Boolean).join(' · ');
}
