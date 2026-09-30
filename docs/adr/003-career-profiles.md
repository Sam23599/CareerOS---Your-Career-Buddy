# ADR-003: Private career profiles

Status: Accepted. Date: 2026-09-30.

## Decision

Keep career data in a `profiles` collection within the existing Node platform. Use the authenticated user's ID as `_id`, relying on MongoDB's unique primary key for one profile per user. Keep login identity and career display name separate. A first read returns defaults without writing.

Expose only owner-scoped GET/PATCH `/api/v1/profiles/me`; administrators use the same ownership boundary. Strictly validate fields before constructing database updates. Save professional URLs without fetching/importing external profiles.

Require a numeric version with each update. First insertion produces version 1; later updates atomically match owner and expected version before incrementing. Return 409 on conflicts. The editor keeps the unsaved draft until the user explicitly reloads. This follows MongoDB's [expected-value filter guidance](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/).

## Consequences

No new service, dependency, migration or extra index is needed. Profile fields can later feed resumes and matching. Replaced lists/preferences must be sent in full. Conflicting edits require manual reconciliation; automatic merging and actual connected-account imports are deferred.

See the [API contract](../api/profiles.md). Resume storage remains the next implementation batch.
