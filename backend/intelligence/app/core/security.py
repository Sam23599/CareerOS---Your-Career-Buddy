import hmac
import re

from app.core.errors import IntelligenceError


class ServiceAuthenticator:
    def __init__(self, token: str):
        self._token = token

    def authenticate(self, authorization: str):
        if not re.fullmatch(r"[a-fA-F0-9]{64,}", self._token):
            raise IntelligenceError(503, "INTELLIGENCE_UNAVAILABLE")
        if not hmac.compare_digest(authorization.encode(), f"Bearer {self._token}".encode()):
            raise IntelligenceError(401, "UNAUTHENTICATED")
