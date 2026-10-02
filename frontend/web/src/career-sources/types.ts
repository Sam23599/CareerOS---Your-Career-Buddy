export type SourceKind = 'bookmark' | 'job-source';
export type SourceFilters = { keywords: string[]; locations: string[] };
export type CareerSource = {
  id: string; kind: SourceKind; company: string; careerUrl: string; keywords: string[]; locations: string[];
  scanHours: number; enabled: boolean; provider: 'greenhouse' | 'google-careers' | null; providerName: string | null;
  sourceId: string | null; coverage: 'complete' | 'limited' | 'link'; canRefresh: boolean; canEnableTracking: boolean; revision: string;
  status: 'unchecked' | 'success' | 'failed'; lastCheckedAt: string | null; importedAt: string | null;
  matchingCount: number; newCount: number; nextScanAt: string | null;
};
export type SourceSupport = Pick<CareerSource, 'provider' | 'providerName' | 'sourceId' | 'coverage' | 'canRefresh' | 'careerUrl'> & { message: string };
export const limitedCoverageMessage = 'Limited coverage: Google imports the first 20 unfiltered public results per check. Filters apply to collected listings; other matching jobs may be absent. Confirm availability on the original career page.';
