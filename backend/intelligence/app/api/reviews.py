from uuid import UUID

from fastapi import Request
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.requests import RequestCancellation
from app.core.security import ServiceAuthenticator
from app.reviews.models import ReviewInput
from app.reviews.service import ResumeReviewService


class ResumeReviewController:
    def __init__(self, token: str, reviews: ResumeReviewService):
        self.auth, self.reviews = ServiceAuthenticator(token), reviews
        self.cancellation = RequestCancellation()

    async def review(self, request: Request):
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
                raise IntelligenceError(413, "REVIEW_LIMIT")
            data.extend(chunk)
        try:
            context = ReviewInput.model_validate_json(bytes(data))
        except ValidationError:
            raise IntelligenceError(400, "INVALID_INPUT") from None
        return await self.cancellation.run(request, self.reviews.review(owner, context))
