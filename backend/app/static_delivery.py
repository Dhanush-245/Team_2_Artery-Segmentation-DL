"""Static delivery helpers: gzip for text assets and long-lived caching for hashed build assets.

Only text-like frontend files are compressed. Images, PDFs and ZIP exports are already compressed and
must keep their exact bytes and sizes, so they are never passed through gzip.
"""
import re

from starlette.middleware.gzip import GZipMiddleware
from starlette.staticfiles import StaticFiles

_TEXT_ASSET = re.compile(r"^/(assets/.+\.(js|css|svg|json|map)|[^/]+\.(webmanifest|svg|txt|json))$")


class TextGzipMiddleware:
    """Apply GZipMiddleware only to JavaScript, CSS, SVG, JSON and manifest files."""

    def __init__(self, app, minimum_size: int = 1024):
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and _TEXT_ASSET.match(scope["path"]):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)


class ImmutableAssets(StaticFiles):
    """Vite writes content-hashed filenames under /assets, so browsers may cache them for a year."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
