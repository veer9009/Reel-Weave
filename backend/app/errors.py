from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class RequestBodyTooLarge(Exception):
    pass


def error_payload(code: str, message: str) -> dict[str, dict[str, str]]:
    return {"error": {"code": code, "message": message}}


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(content=error_payload(exc.code, exc.message), status_code=exc.status_code)


async def http_error_handler(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
    if exc.status_code == 404:
        code, message = "not_found", "The requested endpoint was not found."
    elif exc.status_code == 405:
        code, message = "method_not_allowed", "That method is not allowed for this endpoint."
    else:
        code, message = "http_error", "The request could not be completed."
    return JSONResponse(content=error_payload(code, message), status_code=exc.status_code)


async def validation_error_handler(_request: Request, _exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        content=error_payload("validation_error", "The request is invalid."),
        status_code=422,
    )


async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    import logging

    logging.getLogger("reelweave.api").error(
        "unhandled request error method=%s route=%s type=%s",
        request.method,
        request.url.path,
        type(exc).__name__,
    )
    return JSONResponse(
        content=error_payload("internal_error", "The request could not be completed."),
        status_code=500,
    )


class ContentSizeLimitMiddleware:
    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", ()))
        try:
            content_length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            content_length = 0
        if content_length > self.max_bytes:
            response = JSONResponse(
                content=error_payload("request_too_large", "The upload request is too large."),
                status_code=413,
            )
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> dict:
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > self.max_bytes:
                raise RequestBodyTooLarge
            return message

        await self.app(scope, limited_receive, send)
