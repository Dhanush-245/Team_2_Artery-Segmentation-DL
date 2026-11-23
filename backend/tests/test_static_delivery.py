"""Text assets are compressed and hashed assets are cacheable; binary files are untouched."""
import gzip

from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.routing import Mount

from app.static_delivery import ImmutableAssets, TextGzipMiddleware


def _app(tmp_path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "index-abc123.js").write_text("console.log('x');\n" * 400)
    (assets / "index-abc123.css").write_text("a{color:#000}\n" * 400)
    (assets / "logo-abc123.png").write_bytes(b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 20)
    app = Starlette(routes=[Mount("/assets", ImmutableAssets(directory=str(assets)))])
    app.add_middleware(TextGzipMiddleware)
    return app


def test_text_assets_are_gzipped_and_decode_to_the_original(tmp_path):
    client = TestClient(_app(tmp_path))
    for name, original in (("index-abc123.js", "console.log('x');\n" * 400), ("index-abc123.css", "a{color:#000}\n" * 400)):
        response = client.get(f"/assets/{name}", headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert response.headers["content-encoding"] == "gzip"
        assert response.text == original
        raw = client.get(f"/assets/{name}", headers={"Accept-Encoding": "identity"})
        assert "content-encoding" not in raw.headers and raw.text == original


def test_images_are_never_compressed_and_keep_exact_bytes(tmp_path):
    client = TestClient(_app(tmp_path))
    response = client.get("/assets/logo-abc123.png", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
    assert "content-encoding" not in response.headers
    assert response.content == b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 20


def test_hashed_assets_are_cacheable_for_a_year(tmp_path):
    client = TestClient(_app(tmp_path))
    response = client.get("/assets/index-abc123.js")
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_gzip_is_not_applied_without_client_support(tmp_path):
    client = TestClient(_app(tmp_path))
    response = client.get("/assets/index-abc123.js", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in response.headers
