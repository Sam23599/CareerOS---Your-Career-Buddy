from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    service_token: str = ""
    database_url: str = ""
    openai_key: str = ""
    provider: str = "openai"
    model: str = "gpt-6-luna"
    reasoning: str = "medium"
    timeout: int = 90
    max_input_bytes: int = 60_000
    max_output_tokens: int = 16_384

    @classmethod
    def from_environment(cls):
        # Bounds remain server-owned. Invalid optional configuration disables analysis only.
        return cls(
            service_token=os.getenv("INTELLIGENCE_SERVICE_TOKEN", ""),
            database_url=os.getenv("INTELLIGENCE_DATABASE_URL", ""),
            openai_key=os.getenv("OPENAI_API_KEY", ""),
            model=os.getenv("LLM_MODEL", "gpt-6-luna"),
            reasoning=os.getenv("LLM_REASONING_EFFORT", "medium"),
        )
