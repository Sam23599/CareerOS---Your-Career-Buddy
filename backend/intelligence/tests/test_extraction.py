import asyncio
import io
import logging
import os
import re
import sys
import zlib

import httpx
from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect, Request
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, EncodedStreamObject, NameObject, NumberObject
import pytest

from app import main
from app.core.errors import IntelligenceError as ExtractionError
from app.core.limits import MAX_INPUT, MAX_OUTPUT
from app.parsing.runner import PdfWorkerRunner
run_worker = PdfWorkerRunner().run
from app.core.security import ServiceAuthenticator
from app.api.controller import IntelligenceController
from app.core.settings import Settings
from app.parsing.warnings import ParserWarnings
from app.parsing.pdf import PdfTextExtractor
extract_pdf = PdfTextExtractor().extract

TOKEN = "ab" * 32
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/pdf"}


def pdf(texts=("Resume Tester",), *, encrypted=False, image=False):
    writer = PdfWriter()
    for text in texts:
        page = writer.add_blank_page(width=300, height=300)
        if text:
            font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
            # A tiny ToUnicode map also exercises Unicode extraction without a font dependency.
            cmap = DecodedStreamObject()
            cmap.set_data(b"/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n/CMapType 2 def\n1 begincodespacerange <00> <FF> endcodespacerange\n1 beginbfchar <01> <03A9> endbfchar\nendcmap end end")
            font[NameObject("/ToUnicode")] = writer._add_object(cmap)
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
            stream = DecodedStreamObject()
            escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)").replace("Ω", "\x01")
            stream.set_data(f"BT /F1 12 Tf 20 250 Td ({escaped}) Tj ET".encode("latin-1"))
            page[NameObject("/Contents")] = writer._add_object(stream)
        elif image:
            picture = DecodedStreamObject()
            picture.set_data(b"\xff\x00\x00")
            picture.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"), NameObject("/Width"): NumberObject(1), NameObject("/Height"): NumberObject(1), NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/BitsPerComponent"): NumberObject(8)})
            page[NameObject("/Resources")] = DictionaryObject({NameObject("/XObject"): DictionaryObject({NameObject("/Im1"): writer._add_object(picture)})})
            stream = DecodedStreamObject()
            stream.set_data(b"q 100 0 0 100 0 0 cm /Im1 Do Q")
            page[NameObject("/Contents")] = writer._add_object(stream)
    if encrypted:
        writer.encrypt("a test password")
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("INTELLIGENCE_SERVICE_TOKEN", TOKEN)
    with TestClient(main.app) as client:
        yield client


def test_private_auth_content_type_and_readiness(client):
    assert client.get("/internal/v1/health").status_code == 200
    assert client.get("/internal/v1/ready").status_code == 401
    assert client.get("/internal/v1/ready", headers=HEADERS).status_code == 200
    assert client.post("/internal/v1/resumes/extract", content=b"bad").status_code == 401
    assert client.post("/internal/v1/resumes/extract", headers={"Authorization": f"Bearer {TOKEN}"}, json={"url": "http://example.com"}).status_code == 415
    assert client.post("/internal/v1/resumes/extract", headers=HEADERS, content=b"x" * (MAX_INPUT + 1)).status_code == 413


def test_real_pdf_pages_unicode_blank_pages_and_original_bytes(client):
    original = pdf(("Engineer Ω", "", "Python and TypeScript"))
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=original)
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "extracted"
    assert result["pageCount"] == 3
    assert result["pages"][0]["text"] == "Engineer Ω"
    assert result["pages"][1] == {"number": 2, "text": ""}
    assert result["text"] == "Engineer Ω\n\n\n\nPython and TypeScript"
    assert result["warnings"][0]["code"] == "PAGES_WITHOUT_TEXT"
    assert extract_pdf(original)["text"] == result["text"]


@pytest.mark.parametrize("texts,repair,empty_code", [
    (("Resume Tester",), "index", None),
    (("Resume Tester",), "whitespace", None),
    (("",), "both", "NO_EXTRACTABLE_TEXT"),
    (("Resume Tester", ""), "both", "PAGES_WITHOUT_TEXT"),
])
def test_known_structural_repairs_keep_all_text_and_report_one_safe_warning(client, texts, repair, empty_code):
    original = pdf(texts)
    repaired = original
    if repair in {"index", "both"}:
        # Omit the unused free-object entry; all object offsets remain unchanged.
        repaired = re.sub(rb"xref\n0 (\d+)\n0000000000 65535 f \n", lambda match: b"xref\n1 " + str(int(match[1]) - 1).encode() + b"\n", repaired, count=1)
    if repair in {"whitespace", "both"}:
        # Extra header whitespace, with equal byte lengths to preserve xref offsets.
        repaired = re.sub(rb"(\d+) 0 obj\n", rb"\1  0 obj", repaired)
    assert repaired != original
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=repaired)
    assert response.status_code == 200
    result = response.json()
    assert result["pages"] == extract_pdf(original)["pages"]
    assert result["text"] == extract_pdf(original)["text"]
    expected = ([empty_code] if empty_code else []) + ["PDF_STRUCTURE_REPAIRED"]
    assert [warning["code"] for warning in result["warnings"]] == expected
    assert result["warnings"][-1]["message"] == "Minor PDF structure issues were corrected during extraction. Review the text against your original PDF."


def test_warning_policy_deduplicates_without_formatting_and_rejects_unknown_warnings():
    class PrivateValue:
        def __str__(self):
            raise AssertionError("Document arguments must not be formatted")
        __repr__ = __str__

    safe_template = "Superfluous whitespace found in object header %(idnum)r %(generation)r"
    warnings = ParserWarnings()
    safe_record = logging.LogRecord("pypdf._reader", logging.WARNING, "", 0, safe_template, ({"idnum": PrivateValue(), "generation": PrivateValue()},), None)
    for _ in range(1000):
        warnings.emit(safe_record)
    result = {"warnings": []}
    warnings.apply(result)
    assert [warning["code"] for warning in result["warnings"]] == ["PDF_STRUCTURE_REPAIRED"]
    for name, level, template in [
        ("pypdf._reader", logging.WARNING, "Unknown warning %(private)s"),
        ("pypdf._page", logging.WARNING, safe_template),
        ("pypdf._reader", logging.ERROR, safe_template),
    ]:
        handler = ParserWarnings()
        handler.emit(safe_record)
        handler.emit(logging.LogRecord(name, level, "", 0, template, ({"private": PrivateValue()},), None))
        with pytest.raises(ExtractionError) as caught:
            handler.apply({"warnings": []})
        assert caught.value.code == "INVALID_PDF"


def test_embedded_cff_font_encoding_is_read_with_fonttools(client):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    builder = FontBuilder(1000, isTTF=False)
    glyphs = [".notdef", "uni03A9"]
    builder.setupGlyphOrder(glyphs)
    builder.setupCFF("TestFont", {}, {glyph: T2CharStringPen(500, None).getCharString() for glyph in glyphs}, {})
    cff = builder.font["CFF "].cff
    cff.topDictIndex[0].Encoding = [".notdef"] * 256
    cff.topDictIndex[0].Encoding[1] = "uni03A9"
    embedded = io.BytesIO()
    cff.compile(embedded, builder.font)
    font_file = DecodedStreamObject()
    font_file.set_data(embedded.getvalue())
    font_file[NameObject("/Subtype")] = NameObject("/Type1C")
    writer = PdfWriter(io.BytesIO(pdf(("Ω",))))
    font = writer.pages[0]["/Resources"]["/Font"]["/F1"]
    del font["/ToUnicode"]
    font[NameObject("/FontDescriptor")] = DictionaryObject({NameObject("/FontFile3"): writer._add_object(font_file)})
    output = io.BytesIO()
    writer.write(output)
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=output.getvalue())
    assert response.status_code == 200
    assert response.json()["text"] == "Ω"
    assert response.json()["warnings"] == []


@pytest.mark.parametrize("image", [False, True])
def test_blank_and_image_only_are_explicit_no_text(client, image):
    result = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=pdf(("",), image=image)).json()
    assert result["status"] == "no_text"
    assert result["pages"] == [{"number": 1, "text": ""}]
    assert result["warnings"][0]["code"] == "NO_EXTRACTABLE_TEXT"


@pytest.mark.parametrize("data,code", [(b"%PDF-1.4\ninvalid\n%%EOF", "INVALID_PDF"), (pdf(encrypted=True), "PDF_ENCRYPTED"), (pdf(tuple("" for _ in range(51))), "EXTRACTION_LIMIT"), (pdf(tuple("x" * 5001 for _ in range(40))), "EXTRACTION_LIMIT")], ids=["malformed", "encrypted", "pages", "text"])
def test_invalid_encrypted_page_and_text_limits(client, data, code):
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=data)
    assert response.status_code == (413 if code == "EXTRACTION_LIMIT" else 422)
    assert response.json()["error"]["code"] == code
    assert "invalid\n" not in response.text


def test_compressed_content_limit(client):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=300)
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    compressor = zlib.compressobj()
    encoded = b"".join(compressor.compress(b" " * (1024 * 1024)) for _ in range(300)) + compressor.flush()
    stream = EncodedStreamObject()
    stream._data = encoded
    stream[NameObject("/Filter")] = NameObject("/FlateDecode")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=output.getvalue())
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "EXTRACTION_LIMIT"
    assert client.get("/internal/v1/health").status_code == 200
    assert client.post("/internal/v1/resumes/extract", headers=HEADERS, content=pdf()).status_code == 200


def test_real_worker_address_space_limit():
    script = "from app.core.resources import WorkerMemoryBudget\nimport json\nWorkerMemoryBudget().enforce()\ntry:\n bytearray(300 * 1024 * 1024)\nexcept MemoryError:\n print(json.dumps({'error': {'status': 503, 'code': 'PARSER_RESOURCE_LIMIT'}}))"
    with pytest.raises(ExtractionError) as caught:
        asyncio.run(run_worker(b"", command=[sys.executable, "-c", script]))
    assert caught.value.code == "PARSER_RESOURCE_LIMIT"


def test_damaged_embedded_content_does_not_return_partial_success(client):
    writer = PdfWriter(io.BytesIO(pdf()))
    page = writer.pages[0]
    page["/Resources"][NameObject("/XObject")] = DictionaryObject({NameObject("/Bad"): NameObject("/NotAStream")})
    stream = DecodedStreamObject()
    stream.set_data(page.get_contents().get_data() + b"\nq /Bad Do Q")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    response = client.post("/internal/v1/resumes/extract", headers=HEADERS, content=output.getvalue())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_PDF"


def assert_reaped(pid_file):
    pid = int(pid_file.read_text())
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)


def test_worker_timeout_and_output_limit_reap_children(tmp_path):
    async def exercise():
        for oversized in [False, True]:
            marker = tmp_path / str(oversized)
            script = f"import os,time,pathlib; pathlib.Path({str(marker)!r}).write_text(str(os.getpid())); " + (f"print('x' * {MAX_OUTPUT + 1}); time.sleep(30)" if oversized else "time.sleep(30)")
            with pytest.raises(ExtractionError) as caught:
                await run_worker(b"", command=[sys.executable, "-c", script], timeout=1)
            assert caught.value.code == ("EXTRACTION_LIMIT" if oversized else "INTELLIGENCE_TIMEOUT")
            assert_reaped(marker)
    asyncio.run(exercise())


def test_busy_and_cancellation_release_slot_and_reap_worker(monkeypatch, tmp_path):
    monkeypatch.setenv("INTELLIGENCE_SERVICE_TOKEN", TOKEN)
    marker = tmp_path / "cancelled"
    async def slow_worker(data):
        return await run_worker(data, command=[sys.executable, "-c", f"import os,time,pathlib; pathlib.Path({str(marker)!r}).write_text(str(os.getpid())); time.sleep(30)"])
    monkeypatch.setattr(main.application.extraction.runner, "run", slow_worker)
    async def exercise():
        main.application.extraction.ready = True
        main.application.extraction.active = None
        main.app.state.controller = IntelligenceController(Settings(service_token=TOKEN), main.application.extraction, None)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            first = asyncio.create_task(client.post("/internal/v1/resumes/extract", headers=HEADERS, content=pdf()))
            for _ in range(100):
                if marker.exists(): break
                await asyncio.sleep(.01)
            assert marker.exists()
            second = await client.post("/internal/v1/resumes/extract", headers=HEADERS, content=pdf())
            assert second.status_code == 503
            assert second.json()["error"]["code"] == "INTELLIGENCE_BUSY"
            assert second.headers["Retry-After"] == "5"
            first.cancel()
            await asyncio.gather(first, return_exceptions=True)
            assert main.application.extraction.active is None
            assert_reaped(marker)
    asyncio.run(exercise())


def test_asgi_disconnect_stops_and_reaps_parser(monkeypatch, tmp_path):
    monkeypatch.setenv("INTELLIGENCE_SERVICE_TOKEN", TOKEN)
    marker = tmp_path / "disconnected"
    async def slow_worker(data):
        return await run_worker(data, command=[sys.executable, "-c", f"import os,time,pathlib; pathlib.Path({str(marker)!r}).write_text(str(os.getpid())); time.sleep(30)"])
    monkeypatch.setattr(main.application.extraction.runner, "run", slow_worker)
    async def exercise():
        main.application.extraction.ready = True
        main.application.extraction.active = None
        main.app.state.controller = IntelligenceController(Settings(service_token=TOKEN), main.application.extraction, None)
        disconnected = asyncio.Event()
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": pdf(), "more_body": False}
            await disconnected.wait()
            return {"type": "http.disconnect"}
        request = Request({"type": "http", "headers": [(b"authorization", f"Bearer {TOKEN}".encode()), (b"content-type", b"application/pdf")]}, receive)
        task = asyncio.create_task(main.application.extraction.extract(request))
        for _ in range(100):
            if marker.exists(): break
            await asyncio.sleep(.01)
        assert marker.exists()
        disconnected.set()
        with pytest.raises(ClientDisconnect):
            await task
        assert main.application.extraction.active is None
        assert_reaped(marker)
    asyncio.run(exercise())
