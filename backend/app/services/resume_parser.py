import io
import os
from typing import Tuple
from fastapi import HTTPException
import pypdf
import docx

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB in bytes
ALLOWED_EXTENSIONS = {".pdf", ".docx"}


class ResumeParserException(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str):
        super().__init__(status_code=status_code, detail={"detail": detail, "code": code})


def validate_resume_file(filename: str, file_size: int) -> str:
    ext = os.path.splitext(filename)[1].lower() if filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ResumeParserException(
            status_code=400,
            detail="Unsupported file format. Please upload PDF or DOCX.",
            code="INVALID_FILE_TYPE",
        )
    if file_size > MAX_FILE_SIZE:
        raise ResumeParserException(
            status_code=413,
            detail="File exceeds maximum 10MB limit.",
            code="FILE_TOO_LARGE",
        )
    return ext


def extract_text_from_pdf(content: bytes) -> str:
    try:
        reader = pypdf.PdfReader(io.BytesIO(content))
        text_parts = []
        for page in reader.pages:
            extracted = page.extract_text()
            if extracted:
                text_parts.append(extracted)
        return "\n".join(text_parts).strip()
    except Exception as e:
        raise ResumeParserException(
            status_code=400,
            detail=f"Unable to parse PDF document: {str(e)}",
            code="CORRUPTED_PDF",
        )


def extract_text_from_docx(content: bytes) -> str:
    try:
        doc = docx.Document(io.BytesIO(content))
        paragraphs = [p.text for p in doc.paragraphs if p.text]
        # Also extract table cells if any
        for table in doc.tables:
            for row in table.rows:
                for cell in row.cells:
                    if cell.text:
                        paragraphs.append(cell.text)
        return "\n".join(paragraphs).strip()
    except Exception as e:
        raise ResumeParserException(
            status_code=400,
            detail=f"Unable to parse DOCX document: {str(e)}",
            code="CORRUPTED_DOCX",
        )


def parse_resume(filename: str, content: bytes) -> Tuple[str, int, str]:
    ext = validate_resume_file(filename, len(content))
    if ext == ".pdf":
        extracted_text = extract_text_from_pdf(content)
    elif ext == ".docx":
        extracted_text = extract_text_from_docx(content)
    else:
        raise ResumeParserException(
            status_code=400,
            detail="Unsupported file format. Please upload PDF or DOCX.",
            code="INVALID_FILE_TYPE",
        )

    char_count = len(extracted_text)
    preview = extracted_text[:200] + ("..." if len(extracted_text) > 200 else "")
    return extracted_text, char_count, preview
