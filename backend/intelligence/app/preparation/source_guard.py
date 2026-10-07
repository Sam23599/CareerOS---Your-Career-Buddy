import httpx2 as httpx

from app.core.errors import IntelligenceError


class PlatformSourceGuard:
    """Worker checks current Node-owned availability before spending and before saving."""

    def __init__(self, origin, token):
        self.origin, self.token = origin, token

    async def check(self, owner, context):
        if not self.origin:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        try:
            async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client:
                async with client.stream('POST', self.origin.rstrip('/') + '/internal/v1/intelligence/sources/check',
                    headers={"Authorization": f"Bearer {self.token}"},
                    json={"owner": owner, "resume": context.resume.model_dump(), "jobId": context.jobId,
                          "jobHash": context.jobHash, "profileVersion": context.profile.version if context.profile else None}) as response:
                    if response.status_code == 409:
                        raise IntelligenceError(409, "MATCH_SOURCE_CHANGED")
                    data = bytearray()
                    async for chunk in response.aiter_bytes():
                        if len(data) + len(chunk) > 1024:
                            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
                        data.extend(chunk)
                    if response.status_code != 200 or bytes(data) != b'{"status":"current"}':
                        raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE")
        except httpx.HTTPError:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None
