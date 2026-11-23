"""Client-side routes must survive a refresh; API 404s must stay JSON."""
import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.mark.skipif(not (main.frontend_dist / "index.html").is_file(), reason="frontend not built")
def test_deep_links_serve_the_app_shell():
    with TestClient(main.app) as client:
        for path in ("/cases", "/cases/123/analysis", "/models", "/admin/users"):
            response = client.get(path)
            assert response.status_code == 200, path
            assert "text/html" in response.headers["content-type"]
            assert response.headers["cache-control"] == "no-cache"


def test_unknown_api_and_asset_paths_still_404():
    with TestClient(main.app) as client:
        api = client.get("/api/does-not-exist")
        assert api.status_code == 404 and api.headers["content-type"].startswith("application/json")
        assert client.get("/assets/missing-file.js").status_code == 404
        assert client.get("/missing.png").status_code == 404


@pytest.mark.skipif(not (main.frontend_dist / "manifest.webmanifest").is_file(), reason="frontend not built")
def test_private_app_metadata_is_served():
    with TestClient(main.app) as client:
        robots = client.get("/robots.txt")
        assert robots.status_code == 200 and "Disallow: /" in robots.text
        manifest = client.get("/manifest.webmanifest")
        assert manifest.status_code == 200 and manifest.headers["content-type"].startswith("application/manifest+json")
        assert manifest.json()["start_url"] == "/overview"
        assert 'name="robots" content="noindex, nofollow"' in client.get("/cases").text


@pytest.mark.skipif(main._DOCS, reason="requires API documentation disabled")
@pytest.mark.parametrize("path", ["/docs", "/docs/", "/docs/oauth2-redirect", "/redoc", "/openapi.json"])
def test_disabled_documentation_paths_do_not_serve_the_app_shell(path):
    with TestClient(main.app) as client:
        response = client.get(path)
        assert response.status_code == 404
        assert response.headers["content-type"].startswith("application/json")
