export type CareerSource = {
  id: string; company: string; careerUrl: string; keywords: string[]; locations: string[];
  scanHours: number; enabled: boolean; provider: 'greenhouse' | null; revision: string;
  status: 'unchecked' | 'success' | 'failed'; lastCheckedAt: string | null; importedAt: string | null;
  matchingCount: number; newCount: number; nextScanAt: string | null;
};
