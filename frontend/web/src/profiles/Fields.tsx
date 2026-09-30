import { useState } from 'react';

export function TagsInput({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', '));
  return <label>{label}<input value={text} onChange={event => {
    setText(event.target.value);
    onChange(event.target.value.split(',').map(value => value.trim()).filter(Boolean));
  }} /><span className="field-help">Separate entries with commas.</span></label>;
}

type Field<T> = { key: keyof T; label: string; type?: 'text' | 'month' | 'url' | 'textarea' | 'checkbox'; required?: boolean; maxLength?: number };
export function Entries<T extends object>({ label, items, fields, create, onChange, max }: {
  label: string; items: T[]; fields: Field<T>[]; create: () => T; onChange: (items: T[]) => void; max: number;
}) {
  function update(index: number, key: keyof T, value: string | boolean) {
    onChange(items.map((item, position) => position === index ? {
      ...item, [key]: value, ...(key === 'current' && value === true ? { endDate: '' } : {}),
    } : item));
  }
  return <>
    {items.map((item, index) => <fieldset className="profile-entry" key={index}>
      <legend>{label} {index + 1}</legend>
      <div className="profile-grid">
        {fields.map(field => {
          const current = 'current' in item && item.current === true;
          const disabled = field.key === 'endDate' && current;
          return <label key={String(field.key)} className={field.type === 'checkbox' ? 'check-label' : field.type === 'textarea' ? 'full-width' : ''}>{field.label}
            {field.type === 'checkbox'
              ? <input type="checkbox" checked={Boolean(item[field.key])} onChange={event => update(index, field.key, event.target.checked)} />
              : field.type === 'textarea'
                ? <textarea rows={3} value={String(item[field.key])} maxLength={field.maxLength} onChange={event => update(index, field.key, event.target.value)} />
                : <input type={field.type ?? 'text'} required={field.required} disabled={disabled} maxLength={field.maxLength} value={String(item[field.key])} onChange={event => update(index, field.key, event.target.value)} />}
          </label>;
        })}
      </div>
      <button type="button" className="secondary" onClick={() => onChange(items.filter((_item, position) => position !== index))}>Remove {label.toLowerCase()} {index + 1}</button>
    </fieldset>)}
    <button type="button" className="secondary" disabled={items.length >= max} onClick={() => onChange([...items, create()])}>Add {label.toLowerCase()}</button>
  </>;
}
