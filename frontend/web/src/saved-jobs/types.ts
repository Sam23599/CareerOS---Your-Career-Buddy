export type SavedJob = {
  jobId: string; status: 'SAVED' | 'INTERESTED' | 'NOT_INTERESTED'; priority: 'LOW' | 'MEDIUM' | 'HIGH'; notes: string;
  revision: string; savedAt: string; updatedAt: string; available: boolean;
  job: { title: string; company: string; location: string; source: string; sourceUrl: string; remoteType: string; employmentType: string; expiresAt: string | null };
};
export const statusLabels = { SAVED: 'Saved', INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested' };
