from __future__ import annotations

import json
import logging
from typing import Any, Dict


class StructuredJsonFormatter(logging.Formatter):
    """Formats log records as compact JSON lines."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "time": self.formatTime(record, self.datefmt),
        }
        context = getattr(record, "context", None)
        if isinstance(context, dict):
            payload.update(context)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def get_logger(name: str, level: str = "INFO") -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(level)
    if logger.handlers:
        return logger
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredJsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def log_event(logger: logging.Logger, level: int, message: str, **context: Any) -> None:
    logger.log(level, message, extra={"context": context})
