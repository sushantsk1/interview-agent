import pytest
from fastapi import HTTPException
from backend.app.services.resume_parser import (
    parse_resume,
    validate_resume_file,
    ResumeParserException,
    MAX_FILE_SIZE,
)


def test_validate_resume_file_valid_extensions():
    assert validate_resume_file("resume.pdf", 1000) == ".pdf"
    assert validate_resume_file("RESUME.PDF", 1000) == ".pdf"
    assert validate_resume_file("candidate.docx", 2000) == ".docx"
    assert validate_resume_file("my_cv.DOCX", 2000) == ".docx"


def test_validate_resume_file_invalid_extension():
    with pytest.raises(ResumeParserException) as exc_info:
        validate_resume_file("malicious.exe", 1000)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_FILE_TYPE"

    with pytest.raises(ResumeParserException) as exc_info:
        validate_resume_file("archive.zip", 1000)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_FILE_TYPE"

    with pytest.raises(ResumeParserException) as exc_info:
        validate_resume_file("notes.txt", 1000)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "INVALID_FILE_TYPE"


def test_validate_resume_file_oversize():
    oversize = MAX_FILE_SIZE + 1024
    with pytest.raises(ResumeParserException) as exc_info:
        validate_resume_file("huge.pdf", oversize)
    assert exc_info.value.status_code == 413
    assert exc_info.value.detail["code"] == "FILE_TOO_LARGE"


def test_parse_resume_valid_pdf(sample_pdf_bytes):
    text, char_count, preview = parse_resume("candidate.pdf", sample_pdf_bytes)
    assert "Jane Doe Senior Engineer" in text
    assert char_count > 0
    assert len(preview) <= 203
    assert "Jane Doe Senior Engineer" in preview


def test_parse_resume_valid_docx(sample_docx_bytes):
    text, char_count, preview = parse_resume("candidate.docx", sample_docx_bytes)
    assert "distributed systems" in text
    assert "Senior Backend Engineer" in text
    assert char_count > 0
    assert "Jane Doe" in preview


def test_parse_resume_corrupted_pdf():
    corrupted_bytes = b"Not a real PDF content"
    with pytest.raises(ResumeParserException) as exc_info:
        parse_resume("bad.pdf", corrupted_bytes)
    assert exc_info.value.status_code == 400
    assert exc_info.value.detail["code"] == "CORRUPTED_PDF"
