#!/usr/bin/env python3
"""
fix_hunk_counts.py — Fix wrong @@ -a,b +c,d @@ line counts in unified diffs.

LLMs frequently generate patches with incorrect hunk line counts (the numbers
after the comma in @@ -line,count +line,count @@). This causes git apply and
patch to reject the diff as "corrupt" even when the actual content is correct.

Usage:
  python3 fix_hunk_counts.py < bad.diff > fixed.diff
  python3 fix_hunk_counts.py bad.diff  (in-place fix, prints to stdout)
"""

import re
import sys


def fix_hunk_counts(patch_text: str) -> str:
    """Recount the lines in each hunk and fix the @@ header accordingly."""
    lines = patch_text.split('\n')
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        # Check if this is a hunk header
        m = re.match(r'^(@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@)(.*)', line)
        if m:
            old_start = int(m.group(2))
            new_start = int(m.group(3))
            context_suffix = m.group(4)

            # Count the actual lines in this hunk
            j = i + 1
            old_count = 0
            new_count = 0
            while j < len(lines):
                l = lines[j]
                # Stop at the next hunk header or file header
                if (l.startswith('@@') or l.startswith('diff ')
                        or l.startswith('--- ') or l.startswith('+++ ')):
                    break
                if l.startswith('-'):
                    old_count += 1
                elif l.startswith('+'):
                    new_count += 1
                elif l.startswith('\\'):
                    # "\ No newline at end of file" — don't count
                    pass
                else:
                    # Context line (space-prefixed or empty)
                    old_count += 1
                    new_count += 1
                j += 1

            # Rebuild the hunk header with correct counts
            new_header = (
                f'@@ -{old_start},{old_count} +{new_start},{new_count} @@'
                f'{context_suffix}'
            )
            result.append(new_header)
            i += 1
        else:
            result.append(line)
            i += 1
    return '\n'.join(result)


if __name__ == '__main__':
    if len(sys.argv) > 1:
        with open(sys.argv[1], 'r') as f:
            patch_text = f.read()
    else:
        patch_text = sys.stdin.read()
    print(fix_hunk_counts(patch_text), end='')
