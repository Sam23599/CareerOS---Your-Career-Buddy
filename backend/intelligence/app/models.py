from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .limits import MAX_CHARACTERS, MAX_PAGES


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Page(StrictModel):
    number: int = Field(ge=1, le=MAX_PAGES)
    text: str = Field(max_length=MAX_CHARACTERS)


class Parser(StrictModel):
    name: Literal["pypdf"]
    version: str = Field(min_length=1, max_length=50)


class Warning(StrictModel):
    code: Literal["NO_EXTRACTABLE_TEXT", "PAGES_WITHOUT_TEXT", "PDF_STRUCTURE_REPAIRED"]
    message: str = Field(min_length=1, max_length=300)


class Extraction(StrictModel):
    schemaVersion: Literal[1]
    parser: Parser
    status: Literal["extracted", "no_text"]
    pageCount: int = Field(ge=1, le=MAX_PAGES)
    pages: list[Page] = Field(min_length=1, max_length=MAX_PAGES)
    text: str = Field(max_length=MAX_CHARACTERS)
    warnings: list[Warning] = Field(max_length=2)

    @model_validator(mode="after")
    def consistent_pages(self):
        if self.pageCount != len(self.pages) or any(page.number != i for i, page in enumerate(self.pages, 1)):
            raise ValueError("Invalid page sequence")
        if self.text != "\n\n".join(page.text for page in self.pages):
            raise ValueError("Inconsistent text")
        if (self.status == "extracted") != any(page.text.strip() for page in self.pages):
            raise ValueError("Inconsistent status")
        codes = [warning.code for warning in self.warnings]
        required = "NO_EXTRACTABLE_TEXT" if self.status == "no_text" else "PAGES_WITHOUT_TEXT" if any(not page.text.strip() for page in self.pages) else None
        if len(codes) != len(set(codes)) or set(codes) - {"PDF_STRUCTURE_REPAIRED"} != ({required} if required else set()):
            raise ValueError("Inconsistent warnings")
        return self
