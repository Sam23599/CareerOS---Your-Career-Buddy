# Platform health API

Base path: `/api/v1`. These local diagnostic endpoints do not require authentication.

| Endpoint | Success | Failure |
| --- | --- | --- |
| `GET /health` | `200 {"status":"ok","service":"platform"}` | Does not depend on MongoDB |
| `GET /ready` | `200 {"status":"ready","checks":{"mongodb":"up"}}` | `503` with `status: "not_ready"`, `checks.mongodb: "down"`, and an error object |

Every response includes `X-Request-Id` and `Cache-Control: no-store`. A new server-generated ID links the response to its JSON request log.

Errors use this envelope:

```json
{
  "error": {
    "code": "DATABASE_UNAVAILABLE",
    "message": "Database is unavailable.",
    "requestId": "server-generated-uuid"
  }
}
```

Other codes: `NOT_FOUND` (404), `INVALID_JSON` (400), `PAYLOAD_TOO_LARGE` (413), and `INTERNAL_ERROR` (500). JSON requests are limited to 100 KB. Database error details and stack traces are not returned to clients.
