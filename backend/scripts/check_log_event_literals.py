#!/usr/bin/env python3
"""Fail if log_event(...) uses a string literal for the event name."""

from __future__ import annotations

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [ROOT / "app", ROOT / "main.py"]


def iter_py_files(paths: list[Path]):
    for path in paths:
        if path.is_file() and path.suffix == ".py":
            yield path
        elif path.is_dir():
            for py in path.rglob("*.py"):
                yield py


def is_string_literal(node: ast.AST) -> bool:
    return isinstance(node, ast.Constant) and isinstance(node.value, str)


def find_violations(path: Path):
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text, filename=str(path))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = None
        if isinstance(func, ast.Name):
            name = func.id
        elif isinstance(func, ast.Attribute):
            name = func.attr
        if name != "log_event":
            continue
        if len(node.args) < 2:
            continue
        event_arg = node.args[1]
        if is_string_literal(event_arg):
            yield node.lineno, node.col_offset


def main() -> int:
    violations = []
    for path in iter_py_files(TARGETS):
        for lineno, col in find_violations(path):
            violations.append(f"{path}:{lineno}:{col}")

    if violations:
        print("log_event() must not use string literals for event names.")
        for item in violations:
            print(f"  - {item}")
        return 1

    print("log_event() check passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
