# Career profiles

The protected `/profile` page displays the signed-in user's saved career profile. `/profile/edit` provides the editor; dashboard navigation opens the view first. Both endpoints use `/api/v1` and require `Authorization: Bearer <accessToken>`.

## Read

`GET /api/v1/profiles/me` returns `{ profile }`. Before the first save, it returns empty fields, the account name as `fullName`, `version: 0`, and `updatedAt: null`; reading does not create a document.

## Update

`PATCH /api/v1/profiles/me` requires JSON and the last returned `version`, plus at least one profile field. Omitted top-level fields are preserved. Supplied arrays and `preferences` replace the entire field. Success returns `{ profile }` with an incremented version and ISO `updatedAt`.

```json
{
  "version": 0,
  "headline": "Backend engineer",
  "skills": ["TypeScript", "MongoDB"],
  "links": [{ "label": "GitHub", "url": "https://github.com/example" }]
}
```

Fields:

| Field | Shape / limits |
| --- | --- |
| `fullName`, `headline`, `summary`, `location`, `phone` | Text; maximum lengths 100, 200, 5000, 200, 40. Full name cannot be empty. |
| `skills` | Up to 50 nonempty strings, 100 characters each. |
| `experience` | Up to 30 objects: `company`, `role`, `location`, `startDate`, `endDate`, `current`, `description`. Company, role and start date required. Current roles have empty end dates; other roles require one. |
| `education` | Up to 20 objects: `institution`, `qualification`, `field`, `startDate`, `endDate`. Institution, qualification and start date required; empty end date means ongoing. |
| `certifications` | Up to 30 objects: `name`, `issuer`, `issuedDate`, `url`. Name required. |
| `links` | Up to 20 objects with required `label` (100 characters) and `url`. URLs are saved references; no profile import occurs. |
| `preferences` | Complete object containing `roles`, `locations`, `interests` (up to 30 strings each, 100 characters), `workModes` (`REMOTE`, `HYBRID`, `ONSITE`), `experienceLevel` (empty, `ENTRY`, `MID`, `SENIOR`, `LEAD`), `salaryMin`, `salaryMax`, `currency`, `salaryPeriod` (`YEAR` or `MONTH`). |

Nested text fields allow 200 characters except experience descriptions (3000) and URLs (2048). All object keys listed above must be supplied within a replaced nested object; optional text is represented by `""`. Dates use `YYYY-MM`, years 1900–2199; end cannot precede start. Salary bounds are numbers from 0 to 1 billion or `null`, with maximum at least minimum. Salary requires a three-letter currency code. Text is trimmed; currency is uppercased; tag lists are deduplicated without regard to case. URLs must use HTTP(S) without embedded credentials.

## Ownership and errors

Ownership comes exclusively from the authenticated user. Neither USER nor ADMIN can select another owner's profile. Unknown fields, including user IDs and roles, are rejected. Career full name does not change the login account name.

- `400 INVALID_PROFILE`: invalid fields, version, dates, salary or URLs.
- `401` / `403`: existing authentication/role checks failed.
- `409 PROFILE_CONFLICT`: another save changed the profile; reload the latest version before resubmitting. The UI retains the draft and asks before discarding it.
- `415`: PATCH body is not JSON.

The database uses the user ID as the unique profile `_id`. First-save duplicates and conditional update conflicts both return 409, preventing silent lost updates.
