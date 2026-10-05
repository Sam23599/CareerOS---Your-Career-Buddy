import asyncio

from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError
from pydantic import ValidationError

from app.core.errors import IntelligenceError
from app.llm.models import StructuredRequest, StructuredResult
from app.llm.providers.base import LLMProvider
from app.llm.validation import ResponseValidationError


class OpenAIProvider(LLMProvider):
    def __init__(self, key: str, timeout: int, client=None):
        self.timeout = timeout
        self.client = client or AsyncOpenAI(api_key=key, base_url="https://api.openai.com/v1", timeout=timeout, max_retries=0)

    async def generate(self, request: StructuredRequest) -> StructuredResult:
        options = {"reasoning": {"effort": request.reasoning}} if request.reasoning is not None else {}
        try:
            async with asyncio.timeout(self.timeout):
                result = await self.client.responses.parse(
                    model=request.model, instructions=request.instructions, input=request.input,
                    text_format=request.schema, max_output_tokens=request.max_output_tokens,
                    store=False, **options,
                )
            messages = [item for item in result.output if item.type == "message"]
            if any(part.type == "refusal" for message in messages for part in message.content):
                raise IntelligenceError(422, "LLM_REFUSED")
            # Reasoning models may include a commentary message before their answer.
            # The SDK only parses final-answer text; commentary is not another result.
            messages = [message for message in messages if getattr(message, "phase", None) != "commentary"]
            parts = [part for message in messages for part in message.content if part.type == "output_text"]
            if result.status != "completed":
                if getattr(getattr(result, "incomplete_details", None), "reason", None) == "max_output_tokens":
                    raise IntelligenceError(413, "LLM_BUDGET_LIMIT")
                raise ResponseValidationError("provider", "output_incomplete")
            if len(messages) != 1:
                raise ResponseValidationError("provider", "final_message_count")
            if len(parts) != 1:
                raise ResponseValidationError("provider", "final_text_count")
            if result.output_parsed is None:
                raise ResponseValidationError("provider", "missing_parsed_output")
            value = request.schema.model_validate(result.output_parsed)
            return StructuredResult(value, result.usage.input_tokens if result.usage else 0,
                                    result.usage.output_tokens if result.usage else 0)
        except (TimeoutError, APITimeoutError):
            raise IntelligenceError(504, "LLM_TIMEOUT") from None
        except RateLimitError:
            raise IntelligenceError(429, "LLM_RATE_LIMITED") from None
        except APIError:
            raise IntelligenceError(503, "ANALYSIS_UNAVAILABLE") from None
        except ValidationError as error:
            raise ResponseValidationError.from_schema(error, request.schema) from None
        except (ValueError, TypeError, AttributeError):
            # Never log provider exception details: they may contain resume text.
            raise ResponseValidationError("provider", "malformed_response") from None

    async def close(self):
        await self.client.close()
