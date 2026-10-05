from uuid import UUID

from fastapi import Request
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.requests import RequestCancellation
from app.core.security import ServiceAuthenticator
from app.matching.models import MatchInput
from app.matching.service import MatchingService


class MatchingController:
    def __init__(self, token: str, matching: MatchingService):
        self.auth, self.matching = ServiceAuthenticator(token), matching
        self.cancellation = RequestCancellation()

    async def compare(self, request: Request):
        self.auth.authenticate(request.headers.get("authorization", ""))
        owner = request.headers.get("x-owner-id", "")
        try:
            if str(UUID(owner)) != owner:
                raise ValueError()
        except ValueError:
            raise IntelligenceError(400, "INVALID_INPUT") from None
        if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
            raise IntelligenceError(415, "JSON_REQUIRED")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 16000:
                raise IntelligenceError(413, "MATCHING_LIMIT")
            data.extend(chunk)
        try:
            context = MatchInput.model_validate_json(bytes(data))
        except ValidationError:
            raise IntelligenceError(400, "INVALID_INPUT") from None
        return await self.cancellation.run(request, self.matching.compare(owner, context))
