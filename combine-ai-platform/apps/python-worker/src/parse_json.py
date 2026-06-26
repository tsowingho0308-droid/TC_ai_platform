"""Robust JSON parser for AI responses — mirrors Node.js parseAIJson in lib/server/parse-json.ts

Handles:
- Markdown code fences (```json ... ```)
- Leading/trailing noise before JSON
- jsonrepair-like fallback (trailing commas, etc.)
"""

import json
import re


def parse_ai_json(content: str) -> dict | None:
    """Parse potentially malformed JSON from an LLM response.

    Returns the parsed dict, or None if parsing is impossible.
    """
    if not content or not isinstance(content, str):
        return None

    # Step 1: Strip markdown code fences aggressively
    cleaned = re.sub(r"```[\w]*\s*[\n\r]*", "", content, flags=re.IGNORECASE)
    cleaned = re.sub(r"[\n\r]*\s*```", "", cleaned)
    cleaned = cleaned.strip()

    # Step 2: Skip text before the first { or [
    first_brace = cleaned.find("{")
    first_bracket = cleaned.find("[")
    json_start = -1
    if first_brace >= 0 and first_bracket >= 0:
        json_start = min(first_brace, first_bracket)
    elif first_brace >= 0:
        json_start = first_brace
    elif first_bracket >= 0:
        json_start = first_bracket

    if json_start > 0:
        cleaned = cleaned[json_start:]

    if not cleaned:
        return None

    # Step 3: Direct parse
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Step 4: Try simple repairs (trailing commas, etc.)
    try:
        repaired = _simple_json_repair(cleaned)
        if repaired:
            return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    return None


def _simple_json_repair(text: str) -> str | None:
    """Lightweight JSON repair for common LLM output issues.

    Handles:
    - Trailing commas in objects and arrays
    - Single quotes instead of double quotes
    """
    if not text:
        return None

    repaired = text

    # Remove trailing commas before } or ]
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)

    # Remove trailing comma at end of string (before whitespace)
    repaired = re.sub(r",\s*$", "", repaired)

    # Try to fix single-quoted strings (conservative — only outside already-quoted strings)
    # This is a best-effort fix; for complex cases the caller should fall back to raw content
    if repaired.startswith("{") or repaired.startswith("["):
        # Replace single quotes with double quotes for keys and simple string values
        # Only if the content doesn't already use double quotes extensively
        if repaired.count('"') < repaired.count("'"):
            repaired = _fix_single_quotes(repaired)

    return repaired if repaired != text else None


def _fix_single_quotes(text: str) -> str:
    """Best-effort conversion of single-quoted JSON to double-quoted."""
    result = []
    in_string = False
    string_char = None
    escaped = False

    for ch in text:
        if escaped:
            result.append(ch)
            escaped = False
            continue

        if ch == "\\":
            result.append(ch)
            escaped = True
            continue

        if in_string:
            if ch == string_char:
                in_string = False
                result.append('"')  # always close with double quote
                continue
            result.append(ch)
        else:
            if ch == "'":
                in_string = True
                string_char = "'"
                result.append('"')  # open with double quote
            elif ch == '"':
                in_string = True
                string_char = '"'
                result.append(ch)
            else:
                result.append(ch)

    return "".join(result)
