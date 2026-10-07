from app.api.preparation import PreparationController
from app.cady.models import CadyInput, ResetConversation
from app.core.errors import IntelligenceError
from app.core.requests import RequestCancellation


class CadyController:
    def __init__(self, token, cady):
        self.requests, self.cady = PreparationController(token, None), cady
        self.cancellation = RequestCancellation()

    async def ask(self, request):
        owner = self.requests.identity(request)
        input = await self.requests.body(request, CadyInput)
        return await self.cancellation.run(request, self.cady.ask(owner, input))

    async def conversation(self, request):
        owner = self.requests.identity(request)
        if request.query_params:
            raise IntelligenceError(400, 'INVALID_INPUT')
        return await self.cady.conversations.get(owner)

    async def reset(self, request):
        owner = self.requests.identity(request)
        input = await self.requests.body(request, ResetConversation)
        return await self.cady.conversations.save(owner, input.revision, None, [])
