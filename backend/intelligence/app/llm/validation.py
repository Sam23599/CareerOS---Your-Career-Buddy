import logging

from pydantic import ValidationError

from app.core.errors import IntelligenceError

logger = logging.getLogger(__name__)


class ResponseValidationError(IntelligenceError):
    """Internal diagnostics; the HTTP response retains its fixed, safe error."""

    def __init__(self, stage: str, reason: str, field: str | None = None):
        self.stage, self.reason, self.field = stage, reason, field
        super().__init__(502, "LLM_RESPONSE_INVALID")
        logger.warning("llm_validation_failed stage=%s reason=%s field=%s", stage, reason, field or "output")

    @classmethod
    def from_schema(cls, error: ValidationError, schema):
        # Extra-property names can themselves contain private input. Only emit names
        # declared by our schema and array indexes, never values or exception text.
        names = set()

        def visit(node):
            if isinstance(node, dict):
                names.update(node.get("properties", {}))
                for value in node.values():
                    visit(value)
            elif isinstance(node, list):
                for value in node:
                    visit(value)

        visit(schema.model_json_schema())
        first = error.errors(include_input=False, include_context=False, include_url=False)[0]
        field = ".".join(str(part) if isinstance(part, int) or part in names else "unknown"
                         for part in first["loc"])
        return cls("schema", "schema_invalid", field or None)
