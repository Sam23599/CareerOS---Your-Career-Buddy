from app.api.preparation import PreparationController
from app.cady.models import CadyInput
from app.core.requests import RequestCancellation


class CadyController:
    def __init__(self, token, cady):
        self.requests, self.cady = PreparationController(token, None), cady
        self.cancellation = RequestCancellation()

    async def ask(self, request):
        owner = self.requests.identity(request)
        input = await self.requests.body(request, CadyInput)
        return await self.cancellation.run(request, self.cady.ask(owner, input))
