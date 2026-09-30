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
export type CareerProfile = ProfileData & { version: number; updatedAt: string | null };
