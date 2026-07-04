#!/usr/bin/env python3
"""
ast_patch_applier.py — AST-aware patch application for Andromeda v2.2.0

Accepts a JSON patch specification and applies it to source files using Python's
ast module for precise function/class replacement. This is far more reliable than
unified diffs because:
  1. No line-number sensitivity — functions are located by name, not line number
  2. No context-line brittleness — no "hunk failed" errors from whitespace drift
  3. Handles indentation normalization automatically

Patch spec format (JSON on stdin or --patch-file):
{
  "operations": [
    {
      "type": "replace_function",
      "file": "astropy/modeling/separable.py",
      "name": "_separable_matrix",
      "new_code": "def _separable_matrix(transform):\n    ..."
    },
    {
      "type": "replace_lines",
      "file": "astropy/modeling/core.py",
      "start_pattern": "def _check_inputs",
      "end_pattern": "^def |^class ",
      "new_code": "def _check_inputs(self, ...):\n    ..."
    },
    {
      "type": "insert_after",
      "file": "django/db/models/query.py",
      "after_pattern": "def filter(",
      "new_code": "    # Added by Andromeda\n    pass"
    }
  ]
}

Exit codes:
  0 — all operations applied successfully
  1 — one or more operations failed (details on stderr)
  2 — JSON parse error or missing arguments
"""

import ast
import sys
import json
import re
import os
import textwrap
from typing import Optional


def find_function_or_class_lines(source: str, name: str) -> Optional[tuple[int, int]]:
    """
    Returns (start_line, end_line) of the named function or class in source.
    Lines are 1-indexed. Returns None if not found.
    Uses ast for reliable detection, then maps back to source lines.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        # Fallback to regex if ast parse fails (e.g., Python 2 syntax)
        return find_function_regex(source, name)

    lines = source.split('\n')

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.name == name:
                start = node.lineno  # 1-indexed
                # Find end: walk to the last line of this node
                end = node.end_lineno if hasattr(node, 'end_lineno') else find_end_by_indent(lines, start - 1)
                return (start, end)

    return None


def find_function_regex(source: str, name: str) -> Optional[tuple[int, int]]:
    """Fallback regex-based function finder for files that don't parse cleanly."""
    lines = source.split('\n')
    pattern = re.compile(r'^(\s*)(async\s+)?def\s+' + re.escape(name) + r'\s*[\(:]')
    for i, line in enumerate(lines):
        if pattern.match(line):
            end = find_end_by_indent(lines, i)
            return (i + 1, end)
    return None


def find_end_by_indent(lines: list[str], start_idx: int) -> int:
    """Find the end line of a block starting at start_idx by indentation."""
    base_indent = len(lines[start_idx]) - len(lines[start_idx].lstrip())
    end = start_idx + 1
    while end < len(lines):
        stripped = lines[end].strip()
        if stripped == '':
            end += 1
            continue
        indent = len(lines[end]) - len(lines[end].lstrip())
        if indent <= base_indent and stripped:
            break
        end += 1
    # Back up past trailing blank lines
    while end > start_idx + 1 and lines[end - 1].strip() == '':
        end -= 1
    return end  # exclusive end (0-indexed), so last line is end-1


def apply_replace_function(source: str, name: str, new_code: str) -> tuple[str, bool]:
    """
    Replaces the named function/class in source with new_code.
    Returns (new_source, success).
    """
    location = find_function_or_class_lines(source, name)
    if location is None:
        return source, False

    start_line, end_line = location  # 1-indexed, inclusive
    lines = source.split('\n')

    # Determine the indentation of the original function
    original_indent = len(lines[start_line - 1]) - len(lines[start_line - 1].lstrip())
    indent_str = ' ' * original_indent

    # Normalize new_code indentation
    new_lines = new_code.split('\n')
    # Strip any common leading whitespace from new_code
    dedented = textwrap.dedent(new_code)
    # Re-indent to match the original
    reindented_lines = []
    for i, line in enumerate(dedented.split('\n')):
        if line.strip() == '' and i > 0:
            reindented_lines.append('')
        else:
            reindented_lines.append(indent_str + line if line.strip() else line)

    # Replace lines [start_line-1 : end_line] with new content
    new_source_lines = lines[:start_line - 1] + reindented_lines + lines[end_line:]
    return '\n'.join(new_source_lines), True


def apply_replace_lines(source: str, start_pattern: str, end_pattern: str, new_code: str) -> tuple[str, bool]:
    """
    Replaces lines from the first match of start_pattern to the line before
    the first match of end_pattern (exclusive).
    """
    lines = source.split('\n')
    start_re = re.compile(start_pattern)
    end_re = re.compile(end_pattern)

    start_idx = None
    for i, line in enumerate(lines):
        if start_re.search(line):
            start_idx = i
            break

    if start_idx is None:
        return source, False

    end_idx = len(lines)
    for i in range(start_idx + 1, len(lines)):
        if end_re.search(lines[i]) and lines[i].strip():
            end_idx = i
            break

    new_lines = lines[:start_idx] + new_code.split('\n') + lines[end_idx:]
    return '\n'.join(new_lines), True


def apply_insert_after(source: str, after_pattern: str, new_code: str) -> tuple[str, bool]:
    """Inserts new_code after the first line matching after_pattern."""
    lines = source.split('\n')
    pattern = re.compile(after_pattern)

    for i, line in enumerate(lines):
        if pattern.search(line):
            new_lines = lines[:i + 1] + new_code.split('\n') + lines[i + 1:]
            return '\n'.join(new_lines), True

    return source, False


def main():
    # Read patch spec
    if '--patch-file' in sys.argv:
        idx = sys.argv.index('--patch-file')
        with open(sys.argv[idx + 1]) as f:
            spec = json.load(f)
    else:
        try:
            spec = json.load(sys.stdin)
        except json.JSONDecodeError as e:
            print(f'ERROR: Invalid JSON: {e}', file=sys.stderr)
            sys.exit(2)

    repo_root = sys.argv[sys.argv.index('--repo-root') + 1] if '--repo-root' in sys.argv else '/testbed'
    operations = spec.get('operations', [])

    if not operations:
        print('ERROR: No operations in patch spec', file=sys.stderr)
        sys.exit(2)

    failures = []
    applied = []

    for op in operations:
        op_type = op.get('type')
        file_path = op.get('file', '')
        abs_path = os.path.join(repo_root, file_path)

        if not os.path.exists(abs_path):
            failures.append(f'{op_type} on {file_path}: file not found at {abs_path}')
            continue

        with open(abs_path, 'r', encoding='utf-8', errors='replace') as f:
            source = f.read()

        success = False
        new_source = source

        if op_type == 'replace_function':
            new_source, success = apply_replace_function(source, op['name'], op['new_code'])
        elif op_type == 'replace_lines':
            new_source, success = apply_replace_lines(
                source, op['start_pattern'], op['end_pattern'], op['new_code']
            )
        elif op_type == 'insert_after':
            new_source, success = apply_insert_after(source, op['after_pattern'], op['new_code'])
        else:
            failures.append(f'Unknown operation type: {op_type}')
            continue

        if not success:
            name = op.get('name') or op.get('start_pattern') or op.get('after_pattern', '?')
            failures.append(f'{op_type} on {file_path}: target "{name}" not found')
        else:
            with open(abs_path, 'w', encoding='utf-8') as f:
                f.write(new_source)
            applied.append(f'{op_type} on {file_path}')
            print(f'OK: {op_type} applied to {file_path}')

    if failures:
        for f in failures:
            print(f'FAILED: {f}', file=sys.stderr)
        sys.exit(1)

    print(f'All {len(applied)} operation(s) applied successfully.')
    sys.exit(0)


if __name__ == '__main__':
    main()
