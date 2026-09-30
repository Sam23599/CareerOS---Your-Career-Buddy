import { ApiError } from '../errors.js';
import { type ProfileData, type Preferences } from './model.js';

function invalid(message: string): never { throw new ApiError(400, 'INVALID_PROFILE', message); }
function object(value: unknown, keys: string[], label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object.`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key))) invalid(`${label} contains unsupported fields.`);
  return record;
}
function text(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== 'string') invalid(`${label} must be text.`);
  const result = value.trim();
  if (result.length > max || (required && !result)) invalid(`${label} must contain ${required ? '1' : '0'}–${max} characters.`);
  return result;
}
function array<T>(value: unknown, label: string, max: number, parse: (entry: unknown, label: string) => T): T[] {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} allows up to ${max} entries.`);
  return value.map((entry, index) => parse(entry, `${label} ${index + 1}`));
}
function tags(value: unknown, label: string, max = 30) {
  const entries = array(value, label, max, (entry, name) => text(entry, name, 100, true));
  return entries.filter((entry, index) => entries.findIndex(other => other.toLowerCase() === entry.toLowerCase()) === index);
}
function month(value: unknown, label: string, required = false) {
  const result = text(value, label, 7, required);
  if (result && !/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(result)) invalid(`${label} must be a valid month (YYYY-MM).`);
  return result;
}
function dateRange(start: string, end: string, label: string) {
  if (end && end < start) invalid(`${label}: end date cannot be before start date.`);
}
function url(value: unknown, label: string, required = false) {
  const result = text(value, label, 2048, required);
  if (!result) return '';
  try {
    const parsed = new URL(result);
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid(`${label} must be an HTTP(S) URL without credentials.`);
    return parsed.href;
  } catch { return invalid(`${label} must be a valid HTTP(S) URL.`); }
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid(`${label} has an unsupported value.`);
  return value as T;
}
function salary(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) invalid(`${label} must be a number from 0 to 1,000,000,000, or empty.`);
  return value;
}
function preferences(value: unknown): Preferences {
  const p = object(value, ['roles', 'locations', 'workModes', 'experienceLevel', 'salaryMin', 'salaryMax', 'currency', 'salaryPeriod', 'interests'], 'Preferences');
  const salaryMin = salary(p.salaryMin, 'Minimum salary');
  const salaryMax = salary(p.salaryMax, 'Maximum salary');
  if (salaryMin !== null && salaryMax !== null && salaryMax < salaryMin) invalid('Maximum salary cannot be lower than minimum salary.');
  const currency = text(p.currency, 'Currency', 3).toUpperCase();
  if ((currency && !/^[A-Z]{3}$/.test(currency)) || ((salaryMin !== null || salaryMax !== null) && !currency)) invalid('Enter a three-letter currency code for salary expectations.');
  return {
    roles: tags(p.roles, 'Preferred roles'), locations: tags(p.locations, 'Preferred locations'),
    workModes: [...new Set(array(p.workModes, 'Work modes', 3, value => choice(value, ['REMOTE', 'HYBRID', 'ONSITE'] as const, 'Work mode')))],
    experienceLevel: choice(p.experienceLevel, ['', 'ENTRY', 'MID', 'SENIOR', 'LEAD'], 'Experience level'),
    salaryMin, salaryMax, currency, salaryPeriod: choice(p.salaryPeriod, ['YEAR', 'MONTH'], 'Salary period'), interests: tags(p.interests, 'Career interests'),
  };
}

export function parseProfilePatch(body: unknown): { version: number; changes: Partial<ProfileData> } {
  const data = object(body, ['version', 'fullName', 'headline', 'summary', 'location', 'phone', 'skills', 'experience', 'education', 'certifications', 'preferences', 'links'], 'Profile');
  if (!Number.isSafeInteger(data.version) || (data.version as number) < 0) invalid('Include the profile version returned by the server.');
  if (Object.keys(data).length < 2) invalid('Include at least one field to update.');
  const changes: Partial<ProfileData> = {};
  for (const [key, max] of [['fullName', 100], ['headline', 200], ['summary', 5000], ['location', 200], ['phone', 40]] as const) {
    if (key in data) changes[key] = text(data[key], key === 'fullName' ? 'Full name' : key, max, key === 'fullName');
  }
  if ('skills' in data) changes.skills = tags(data.skills, 'Skills', 50);
  if ('experience' in data) changes.experience = array(data.experience, 'Experience', 30, (entry, label) => {
    const e = object(entry, ['company', 'role', 'location', 'startDate', 'endDate', 'current', 'description'], label);
    const startDate = month(e.startDate, `${label} start date`, true);
    const endDate = month(e.endDate, `${label} end date`);
    if (typeof e.current !== 'boolean') invalid(`${label}: select whether this is your current role.`);
    if (e.current && endDate) invalid(`${label}: a current role must not have an end date.`);
    if (!e.current && !endDate) invalid(`${label}: enter an end date or mark the role as current.`);
    dateRange(startDate, endDate, label);
    return { company: text(e.company, `${label} company`, 200, true), role: text(e.role, `${label} role`, 200, true), location: text(e.location, `${label} location`, 200), startDate, endDate, current: e.current, description: text(e.description, `${label} description`, 3000) };
  });
  if ('education' in data) changes.education = array(data.education, 'Education', 20, (entry, label) => {
    const e = object(entry, ['institution', 'qualification', 'field', 'startDate', 'endDate'], label);
    const startDate = month(e.startDate, `${label} start date`, true);
    const endDate = month(e.endDate, `${label} end date`);
    dateRange(startDate, endDate, label);
    return { institution: text(e.institution, `${label} institution`, 200, true), qualification: text(e.qualification, `${label} qualification`, 200, true), field: text(e.field, `${label} field of study`, 200), startDate, endDate };
  });
  if ('certifications' in data) changes.certifications = array(data.certifications, 'Certifications', 30, (entry, label) => {
    const c = object(entry, ['name', 'issuer', 'issuedDate', 'url'], label);
    return { name: text(c.name, `${label} name`, 200, true), issuer: text(c.issuer, `${label} issuer`, 200), issuedDate: month(c.issuedDate, `${label} issue date`), url: url(c.url, `${label} URL`) };
  });
  if ('links' in data) changes.links = array(data.links, 'Professional links', 20, (entry, label) => {
    const link = object(entry, ['label', 'url'], label);
    return { label: text(link.label, `${label} label`, 100, true), url: url(link.url, `${label} URL`, true) };
  });
  if ('preferences' in data) changes.preferences = preferences(data.preferences);
  return { version: data.version as number, changes };
}
