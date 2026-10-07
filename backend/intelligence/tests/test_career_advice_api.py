import asyncio
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.api.preparation import PreparationController
from app.api.cady import CadyController
from app.core.errors import IntelligenceError
from test_preparation import setup


def test_private_advice_routes_authenticate_and_bound_inputs_before_work():
    owner, preparation, input, provider = asyncio.run(setup())
    token = 'a' * 64
    controller, cady = PreparationController(token, preparation), CadyController(token, None)
    app = FastAPI()
    @app.exception_handler(IntelligenceError)
    async def handle(request, error): return JSONResponse({'code': error.code}, status_code=error.status)
    async def start(job_id: str, request: Request): return await controller.start(job_id, request)
    async def ask(request: Request): return await cady.ask(request)
    app.add_api_route('/jobs/{job_id}/plans', start, methods=['POST'])
    app.add_api_route('/cady', ask, methods=['POST'])
    headers = {'Authorization': 'Bearer ' + token, 'X-Owner-Id': owner, 'Content-Type': 'application/json'}
    with TestClient(app) as client:
        assert client.post('/jobs/' + input.context.jobId + '/plans', content='x' * 61000).status_code == 401
        assert client.post('/cady', content='x' * 61000).status_code == 401
        assert client.post('/cady', headers=headers, content='x' * 61000).status_code == 413
        assert client.post('/cady?owner=' + str(uuid4()), headers=headers, json={}).status_code == 400
        assert client.post('/cady', headers=headers, json={'owner': owner}).status_code == 400
        assert client.post('/jobs/' + '0' * 64 + '/plans', headers=headers, json=input.model_dump()).status_code == 400
        assert client.post('/jobs/' + input.context.jobId + '/plans', headers={**headers, 'X-Owner-Id': str(uuid4())}, json=input.model_dump()).status_code == 404
        assert client.post('/jobs/' + input.context.jobId + '/plans', headers=headers, json={**input.model_dump(), 'owner': owner}).status_code == 400
    assert not provider.requests
