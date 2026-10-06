export type SavedJob = {
  applicationStatus?: 'NOT_APPLIED' | 'APPLIED' | 'IN_PROGRESS' | 'INTERVIEWING' | 'OFFERED' | 'REJECTED' | 'WITHDRAWN'; applicationEvents?: { status: string; at: string }[];
  jobId: string; status: 'SAVED' | 'INTERESTED' | 'NOT_INTERESTED'; priority: 'LOW' | 'MEDIUM' | 'HIGH'; notes: string;
  revision: string; savedAt: string; updatedAt: string; available: boolean;
  job: { title: string; company: string; location: string; source: string; sourceUrl: string; remoteType: string; employmentType: string; postedAt?: string | null; expiresAt: string | null };
};
export const statusLabels = { SAVED: 'Saved', INTERESTED: 'Interested', NOT_INTERESTED: 'Not interested' };

export const applicationLabels = { NOT_APPLIED: 'Not applied', APPLIED: 'Applied', IN_PROGRESS: 'Application in progress', INTERVIEWING: 'Interviewing', OFFERED: 'Offer received', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' };
