import { type JobInput } from './model.js';

// Conservative, repeatable extraction. Explicit upstream values always win.
export class JobMetadataNormalizer {
  static readonly version = 2;
  normalize<T extends JobInput>(job: T): T {
    const text = `${job.title}\n${job.description}`;
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const known = ['Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'React', 'Node.js', 'SQL', 'PostgreSQL', 'MongoDB', 'Docker', 'Kubernetes', 'AWS', 'Azure', 'Golang', 'Rust', 'Ruby', 'PHP', 'Kotlin', 'HTML', 'CSS', 'Git', 'Linux'];
    const inferred = known.filter(skill => new RegExp(`(^|[^\\w+#])${escape(skill)}(?=$|[^\\w+#])`, 'i').test(text));
    const fields: string[] = [];
    const skills = [...new Set([...job.skills, ...inferred])].slice(0, 100);
    if (skills.length > job.skills.length) fields.push('skills');
    let employmentType = job.employmentType, remoteType = job.remoteType;
    if (employmentType === 'UNKNOWN') {
      const matches = [['FULL_TIME', /\bfull[ -]time\b/i], ['PART_TIME', /\bpart[ -]time\b/i], ['INTERNSHIP', /\b(internship|intern position)\b/i], ['CONTRACT', /\b(contract role|contract position|contractor)\b/i], ['TEMPORARY', /\btemporary (role|position)\b/i]] as const;
      const found = matches.filter(([, pattern]) => pattern.test(text));
      if (found.length === 1 && !/\b(not|no)[ -]+(a[ -]+)?(full|part)[ -]time\b/i.test(text)) { employmentType = found[0][0]; fields.push('employmentType'); }
    }
    if (remoteType === 'UNKNOWN') {
      const modes = [['HYBRID', /\bhybrid (work|role|position|schedule|model)\b/i], ['ONSITE', /\b(on[ -]site|in[ -]office) (work|role|position|required)\b/i], ['REMOTE', /\b(fully remote|100% remote|remote (role|position|work)|work from home)\b/i]] as const;
      const found = modes.filter(([, pattern]) => pattern.test(text));
      const negative = /\b(not|no|non)[ -]remote\b|\bno work from home\b/i.test(text);
      if (found.length === 1 && !(found[0][0] === 'REMOTE' && negative)) { remoteType = found[0][0]; fields.push('remoteType'); }
    }
    const contactEmails = [...new Set(text.match(/[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,24}/gi) ?? [])].slice(0, 10);
    return { ...job, skills, employmentType, remoteType, metadata: { ...job.metadata, contactEmails, normalizationVersion: JobMetadataNormalizer.version, inferredFields: [...new Set([...(job.metadata.inferredFields ?? []), ...fields])] } };
  }
}
