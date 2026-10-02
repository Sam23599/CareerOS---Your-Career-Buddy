import asyncio

from starlette.requests import ClientDisconnect, Request


class RequestCancellation:
    """Consume disconnect events directly; cancellation must never be swallowed."""

    async def _monitor(self, request: Request):
        while True:
            if (await request.receive())["type"] == "http.disconnect":
                return

    async def run(self, request: Request, work):
        worker = asyncio.create_task(work)
        disconnected = asyncio.create_task(self._monitor(request))
        try:
            completed, _ = await asyncio.wait([worker, disconnected], return_when=asyncio.FIRST_COMPLETED)
            if disconnected in completed:
                raise ClientDisconnect()
            return await worker
        finally:
            for task in [worker, disconnected]:
                if not task.done():
                    task.cancel()
            await asyncio.gather(worker, disconnected, return_exceptions=True)
