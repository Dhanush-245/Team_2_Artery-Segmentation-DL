"""Render one PDF page to PNG in a separate process (stdin: PDF bytes, stdout: PNG).

Run as ``python -m app.pdf_render <page_index>``. PDFium (pypdfium2) is self-contained, so the
image needs no Poppler system libraries. The caller enforces a timeout, so a malformed PDF can
neither hang nor crash the application process.
"""
import sys
from io import BytesIO

LONGEST_SIDE = 2048
MAX_PAGES = 1000


def render(raw: bytes, page_index: int) -> bytes:
    import pypdfium2 as pdfium
    document = pdfium.PdfDocument(raw)
    try:
        if not 0 <= page_index < min(len(document), MAX_PAGES):
            raise ValueError('page index outside the document')
        page = document[page_index]
        width, height = page.get_size()
        if width <= 0 or height <= 0:
            raise ValueError('page has no area')
        scale = LONGEST_SIDE / max(width, height)
        image = page.render(scale=scale).to_pil().convert('RGB')
        out = BytesIO()
        image.save(out, format='PNG')
        return out.getvalue()
    finally:
        document.close()


def main() -> int:
    try:
        sys.stdout.buffer.write(render(sys.stdin.buffer.read(), int(sys.argv[1])))
        return 0
    except Exception as error:  # reported to the caller as a non-zero exit, never as image bytes
        sys.stderr.write(f'{type(error).__name__}\n')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
