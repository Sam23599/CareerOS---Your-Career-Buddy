import re
from uuid import UUID

from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.core.security import ServiceAuthenticator
from app.preparation.models import PlanReview, PreparationInput


class PreparationController:
    def __init__(self, token, preparation):
        self.auth, self.preparation = ServiceAuthenticator(token), preparation

    def identity(self, request, job_id=None, plan_id=None):
        self.auth.authenticate(request.headers.get('authorization', ''))
        owner = request.headers.get('x-owner-id', '')
        try:
            if str(UUID(owner)) != owner or (job_id is not None and not re.fullmatch(r'[a-f0-9]{64}', job_id)) or (plan_id is not None and str(UUID(plan_id)) != plan_id):
                raise ValueError()
        except ValueError:
            raise IntelligenceError(400, 'INVALID_INPUT') from None
        return owner

    async def body(self, request, schema):
        if request.query_params:
            raise IntelligenceError(400, 'INVALID_INPUT')
        if request.headers.get('content-type', '').split(';')[0] != 'application/json':
            raise IntelligenceError(415, 'JSON_REQUIRED')
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 60000:
                raise IntelligenceError(413, 'LLM_BUDGET_LIMIT')
            data.extend(chunk)
        try:
            return schema.model_validate_json(bytes(data))
        except ValidationError:
            raise IntelligenceError(400, 'INVALID_INPUT') from None

    async def start(self, job_id, request):
        owner = self.identity(request, job_id)
        input = await self.body(request, PreparationInput)
        if input.context.jobId != job_id:
            raise IntelligenceError(400, 'INVALID_INPUT')
        await self.preparation.validate_input(owner, input)
        return {'taskId': await request.app.state.tasks.start_preparation(owner, input)}

    async def get(self, job_id, plan_id, request):
        owner = self.identity(request, job_id, plan_id)
        if request.query_params:
            raise IntelligenceError(400, 'INVALID_INPUT')
        return await self.preparation.repository.get(owner, job_id, plan_id)

    async def history(self, job_id, request):
        owner = self.identity(request, job_id)
        params = list(request.query_params.multi_items())
        before = request.query_params.get('beforeVersion')
        if params and (len(params) != 1 or params[0][0] != 'beforeVersion' or not re.fullmatch(r'[1-9][0-9]{0,9}', before or '') or int(before) > 2147483647):
            raise IntelligenceError(400, 'INVALID_INPUT')
        return await self.preparation.repository.history(owner, job_id, int(before) if before else None)

    async def review(self, job_id, plan_id, request):
        owner = self.identity(request, job_id, plan_id)
        return await self.preparation.repository.review(owner, job_id, plan_id, await self.body(request, PlanReview))
