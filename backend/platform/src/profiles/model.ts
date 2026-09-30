export type Experience = { company: string; role: string; location: string; startDate: string; endDate: string; current: boolean; description: string };
export type Education = { institution: string; qualification: string; field: string; startDate: string; endDate: string };
export type Certification = { name: string; issuer: string; issuedDate: string; url: string };
export type ProfessionalLink = { label: string; url: string };
export type Preferences = {
  roles: string[]; locations: string[]; workModes: ('REMOTE' | 'HYBRID' | 'ONSITE')[];
  experienceLevel: '' | 'ENTRY' | 'MID' | 'SENIOR' | 'LEAD';
  salaryMin: number | null; salaryMax: number | null; currency: string; salaryPeriod: 'YEAR' | 'MONTH'; interests: string[];
};
export type ProfileData = {
  fullName: string; headline: string; summary: string; location: string; phone: string;
  skills: string[]; experience: Experience[]; education: Education[]; certifications: Certification[];
  preferences: Preferences; links: ProfessionalLink[];
};
export type ProfileDocument = ProfileData & { _id: string; version: number; createdAt: Date; updatedAt: Date };

export function emptyProfile(name: string): ProfileData {
  return {
    fullName: name, headline: '', summary: '', location: '', phone: '', skills: [], experience: [], education: [], certifications: [], links: [],
    preferences: { roles: [], locations: [], workModes: [], experienceLevel: '', salaryMin: null, salaryMax: null, currency: '', salaryPeriod: 'YEAR', interests: [] },
  };
}
export function profileResponse(document: ProfileDocument) {
  const { _id: _owner, createdAt: _created, updatedAt, ...profile } = document;
  void _owner; void _created;
  return { ...profile, updatedAt: updatedAt.toISOString() };
}
