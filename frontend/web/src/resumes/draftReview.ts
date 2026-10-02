import { type ProfileData } from '../profiles/types.js';

export type Fact = { value: string | null; evidence: { page: number; quote: string }[] };
type Row = Record<string, Fact | Fact[]>;
export type ResumeDraft = {
  fullName: Fact; headline: Fact; summary: Fact; location: Fact; phone: Fact;
  skills: Fact[]; technologies: Fact[]; experience: Row[]; education: Row[];
  certifications: Row[]; links: Row[];
} & Record<string, unknown>;
export type DraftRecord = {
  id: string; version: number; model: string; reasoning: string | null; createdAt: string;
  source: { resumeId: string; resumeVersion: number; sha256: string };
  extraction: { warnings: { code: string; message: string }[] };
  draft: ResumeDraft;
};
export type DraftSummary = Pick<DraftRecord, 'id' | 'version' | 'model' | 'reasoning' | 'createdAt'>;
export type DraftHistory = { versions: DraftSummary[]; nextBeforeVersion: number | null };
export const supportedFields = ['fullName', 'headline', 'summary', 'location', 'phone', 'skills', 'experience', 'education', 'certifications', 'links'] as const;
export type ReviewField = typeof supportedFields[number];
export type ReviewValues = Pick<ProfileData, ReviewField>;
export const fieldLabels: Record<ReviewField, string> = {
  fullName: 'Full name', headline: 'Headline', summary: 'Professional summary', location: 'Location', phone: 'Phone',
  skills: 'Skills', experience: 'Experience', education: 'Education', certifications: 'Certifications', links: 'Professional links',
};

export class DraftReview {
  static value(fact: Fact | Fact[] | undefined): string {
    return fact && !Array.isArray(fact) ? fact.value ?? '' : '';
  }
  static month(text: string): string {
    if (/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(text)) return text;
    const match = /^(\w+)\s+((?:19|20|21)\d{2})$/.exec(text.trim());
    const months = [['jan', 'january'], ['feb', 'february'], ['mar', 'march'], ['apr', 'april'], ['may'], ['jun', 'june'],
      ['jul', 'july'], ['aug', 'august'], ['sep', 'sept', 'september'], ['oct', 'october'], ['nov', 'november'], ['dec', 'december']];
    const month = match ? months.findIndex(names => names.includes(match[1].toLowerCase())) : -1;
    // A year alone is never turned into an invented January date.
    return month < 0 || !match ? '' : `${match[2]}-${String(month + 1).padStart(2, '0')}`;
  }
  private static merge<T>(existing: T[], additions: T[], key: (item: T) => string): T[] {
    const seen = new Set(existing.map(key));
    return [...existing, ...additions.filter(item => {
      const id = key(item); if (seen.has(id)) return false; seen.add(id); return true;
    })];
  }
  static suggest(draft: ResumeDraft, profile: ProfileData): ReviewValues {
    const value = this.value;
    const experience = draft.experience.map(row => {
      const end = value(row.endDate);
      const achievements = Array.isArray(row.achievements) ? row.achievements.map(value).filter(Boolean) : [];
      return { company: value(row.company), role: value(row.role), location: value(row.location),
        startDate: this.month(value(row.startDate)), endDate: this.month(end), current: /^(present|current|ongoing)$/i.test(end.trim()),
        description: [value(row.description), ...achievements].filter(Boolean).join('\n') };
    });
    const education = draft.education.map(row => ({ institution: value(row.institution), qualification: value(row.qualification),
      field: value(row.field), startDate: this.month(value(row.startDate)), endDate: this.month(value(row.endDate)) }));
    const certifications = draft.certifications.map(row => ({ name: value(row.name), issuer: value(row.issuer),
      issuedDate: this.month(value(row.issuedDate)), url: value(row.url) }));
    const links = draft.links.map(row => ({ label: value(row.label), url: value(row.url) }));
    const identity = Object.fromEntries((['fullName', 'headline', 'summary', 'location', 'phone'] as const)
      .map(key => [key, value(draft[key]) || profile[key]])) as Pick<ReviewValues, 'fullName' | 'headline' | 'summary' | 'location' | 'phone'>;
    return { ...identity,
      skills: this.merge(profile.skills, [...draft.skills, ...draft.technologies].map(value).filter(Boolean), item => item.toLowerCase()),
      experience: this.merge(profile.experience, experience, item => `${item.company}:${item.role}:${item.startDate}`.toLowerCase()),
      education: this.merge(profile.education, education, item => `${item.institution}:${item.qualification}:${item.startDate}`.toLowerCase()),
      certifications: this.merge(profile.certifications, certifications, item => `${item.name}:${item.issuer}`.toLowerCase()),
      links: this.merge(profile.links, links, item => item.url.toLowerCase()),
    };
  }
}

export function readableValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(readableValue).join('\n\n') || 'None';
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key.replace(/([A-Z])/g, ' $1')}: ${readableValue(item)}`).join('\n');
  return value === true ? 'Yes' : value === false ? 'No' : String(value || 'Not specified');
}
