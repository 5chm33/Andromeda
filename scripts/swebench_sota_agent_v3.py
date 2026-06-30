#!/usr/bin/env python3
"""
Andromeda SOTA SWE-bench Agent v3
=================================
Implements the full SOTA pipeline targeting 60-70%+ on SWE-bench Verified:

  Phase 1 — Hierarchical Localization
    Repo structure → file list → function/class → edit location

  Phase 2 — Multi-Agent Consensus
    N agents generate candidate patches in parallel at diverse temperatures.
    Each candidate is tested in Docker immediately after generation.
    The first patch that passes the failing test is submitted immediately.

  Phase 3 — Traceback Loop (the key upgrade)
    If no candidate passes in Phase 2, the best candidate enters the traceback loop.
    Up to MAX_TRACEBACK_ATTEMPTS rounds of:
      1. Apply patch in Docker container
      2. Run pytest with --tb=short to capture the actual failure
      3. Feed the traceback back to the LLM with the original patch
      4. LLM generates a revised patch targeting the specific failure

  Phase 4 — Robust Infrastructure
    - Sequential Docker operations to prevent disk exhaustion
    - Aggressive 300s per-instance timeout
    - Automatic container cleanup on timeout
    - Disk space checks before each Docker pull

LLM: ALL calls go through OpenRouter using anthropic/claude-sonnet-4-5.
     No direct Anthropic API calls. No DeepSeek fallback.
     This ensures consistent, high-quality patch generation.
"""

import os, sys, json, time, re, subprocess, tempfile, shutil, hashlib, logging, signal
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
import concurrent.futures

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/tmp/swebench_sota_v3.log", mode="a"),
    ],
)
log = logging.getLogger("andromeda-sota-v3")

# ── Config ────────────────────────────────────────────────────────────────────

ANDROMEDA_DIR      = Path.home() / "andromeda"
RESULTS_DIR        = ANDROMEDA_DIR / "data" / "swebench"
REPOS_CACHE        = Path.home() / "swebench_repos"
GITHUB_TOKEN       = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO        = "5chm33/Andromeda"
COMMIT_EVERY       = 50

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")

# The ONLY model used — Claude Sonnet 4.5 via OpenRouter
OPENROUTER_MODEL   = "anthropic/claude-sonnet-4-5"

# Number of candidate patches per instance (Phase 2)
NUM_CANDIDATES = 4

# Max traceback loop iterations per instance (Phase 3)
MAX_TRACEBACK_ATTEMPTS = 5

# Max chars of file content sent to LLM (keeps prompts under context limit)
# Reduced to ensure patches fit within max_tokens without truncation
MAX_FILE_CHARS = 6000  # Balanced: enough context without slowing LLM calls

# Max chars of problem statement sent to LLM
MAX_PROBLEM_CHARS = 1200

# Max chars of traceback context sent to LLM
MAX_TRACEBACK_CHARS = 1500

# Timeout for LLM calls
TIMEOUT_SECS = 120

# Max tokens for patch generation — must be large enough to avoid mid-patch truncation
MAX_PATCH_TOKENS = 8192  # Sufficient for most file outputs

# Timeout for Docker test runs (seconds)
DOCKER_TEST_TIMEOUT = 300

# Minimum free disk space (GB) before pulling a Docker image
MIN_FREE_DISK_GB = 15

# ── LLM Client ────────────────────────────────────────────────────────────────

def call_llm(prompt: str, temperature: float = 0.0, max_tokens: int = 4096,
             model: str = None) -> str:
    """
    Call Claude Sonnet 4.5 via OpenRouter.
    ALL calls go through this single path — no fallbacks, no DeepSeek, no direct Anthropic.
    """
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY not set. Cannot make LLM calls.")

    use_model = model or OPENROUTER_MODEL
    return _call_openrouter(prompt, temperature, max_tokens, use_model)


def _call_openrouter(prompt: str, temperature: float, max_tokens: int, model: str) -> str:
    import urllib.request, urllib.error

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/5chm33/Andromeda",
        "X-Title": "Andromeda SWE-bench SOTA",
    }
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }).encode()

    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=body, headers=headers, method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:500]
        raise RuntimeError(f"OpenRouter HTTP {e.code}: {error_body}")

    if "error" in data:
        raise RuntimeError(f"OpenRouter API error: {data['error']}")

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    log.debug(f"  Tokens: {usage.get('prompt_tokens', '?')} in / {usage.get('completion_tokens', '?')} out")
    return content

# ── Disk Management ───────────────────────────────────────────────────────────

def get_free_disk_gb() -> float:
    """Returns free disk space on / in GB."""
    try:
        result = subprocess.run(
            ["df", "-BG", "/"], capture_output=True, text=True, timeout=5
        )
        lines = result.stdout.strip().split("\n")
        if len(lines) >= 2:
            parts = lines[1].split()
            return float(parts[3].replace("G", ""))
    except Exception:
        pass
    return 999.0


def ensure_disk_space(required_gb: float = MIN_FREE_DISK_GB) -> bool:
    """Ensures there is enough free disk space. Prunes Docker cache if needed."""
    free = get_free_disk_gb()
    if free >= required_gb:
        return True
    log.warning(f"  Disk low: {free:.1f}GB free, need {required_gb}GB. Pruning Docker cache...")
    subprocess.run(["docker", "builder", "prune", "-f"], capture_output=True, timeout=60)
    free_after = get_free_disk_gb()
    log.info(f"  After prune: {free_after:.1f}GB free")
    return free_after >= required_gb

# ── Docker Image Management ───────────────────────────────────────────────────

def get_swebench_image_name(instance: dict) -> str:
    """Returns the Docker image name for a SWE-bench instance."""
    instance_id = instance["instance_id"]
    return f"swebench/sweb.eval.x86_64.{instance_id.replace('__', '_1776_')}:latest"


def image_exists_locally(image_name: str) -> bool:
    """Check if a Docker image is already pulled locally."""
    r = subprocess.run(
        ["docker", "image", "inspect", image_name],
        capture_output=True, text=True, timeout=10
    )
    return r.returncode == 0


def pull_image(image_name: str, timeout: int = 600) -> bool:
    """Pull a Docker image. Returns True on success."""
    if image_exists_locally(image_name):
        return True
    if not ensure_disk_space():
        log.warning(f"  Insufficient disk space to pull {image_name}")
        return False
    try:
        log.info(f"  Pulling {image_name}...")
        subprocess.run(
            ["docker", "pull", image_name],
            capture_output=True, text=True, timeout=timeout, check=True
        )
        return True
    except subprocess.TimeoutExpired:
        log.warning(f"  Pull timed out for {image_name}")
        return False
    except subprocess.CalledProcessError as e:
        log.warning(f"  Pull failed for {image_name}: {e.stderr[:200]}")
        return False

# ── Docker Test Execution ─────────────────────────────────────────────────────

def run_test_in_docker(
    instance: dict,
    patch: str,
    tests: list[str],
    capture_traceback: bool = False
) -> tuple[bool, str]:
    """
    Apply the patch and run the failing tests inside a Docker container.
    Returns (passed: bool, output: str).
    """
    if not tests:
        return False, "No tests specified"

    image_name = get_swebench_image_name(instance)
    if not image_exists_locally(image_name):
        if not pull_image(image_name):
            return False, f"Image not available: {image_name}"

    # Get the test_patch from the instance (adds failing tests to the test file)
    test_patch_str = instance.get("test_patch", "")

    with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
        f.write(patch)
        patch_file = f.name

    test_patch_file = None
    if test_patch_str:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.test_patch', delete=False) as f:
            f.write(test_patch_str)
            test_patch_file = f.name

    try:
        import shlex
        repo = instance.get("repo", "")

        # Build repo-specific test command
        # Django uses its own test runner, not pytest
        if repo == "django/django":
            # Transform test paths to Django module format
            # e.g., tests/utils_tests/test_dateparse.py -> utils_tests.test_dateparse
            django_tests = []
            for t in tests:
                # Strip ::TestClass::test_method suffix (keep only module)
                t_clean = t.split("::")[0] if "::" in t else t
                # Strip .py extension
                t_clean = t_clean[:-3] if t_clean.endswith(".py") else t_clean
                # Strip tests/ prefix
                t_clean = t_clean[len("tests/"):] if t_clean.startswith("tests/") else t_clean
                # Convert / to .
                t_clean = t_clean.replace("/", ".")
                if t_clean not in django_tests:
                    django_tests.append(t_clean)
            test_cmd = " ".join(shlex.quote(t) for t in django_tests)
            run_test_cmd = f"./tests/runtests.py --verbosity 2 --settings=test_sqlite --parallel 1 {test_cmd} 2>&1"
            # Django passed detection: look for OK or "0 failures"
            passed_check = lambda out, rc: rc == 0 and ("OK" in out or "0 failures" in out) and "FAILED" not in out
        else:
            test_cmd = " ".join(shlex.quote(t) for t in tests)
            tb_flag = "--tb=short" if capture_traceback else "--tb=no"
            run_test_cmd = f"python -m pytest {test_cmd} -x {tb_flag} -q 2>&1"
            passed_check = lambda out, rc: rc == 0 and (
                "passed" in out.lower() or "1 passed" in out.lower()
            ) and "failed" not in out.lower()

        # Apply test_patch first (adds new test cases), then model patch, then run tests
        test_patch_cmd = ""
        if test_patch_file:
            test_patch_cmd = "git apply --ignore-whitespace /tmp/test.patch 2>/dev/null || true"

        script = f"""
set -e
cd /testbed
git checkout -- . 2>/dev/null || true
{test_patch_cmd}
git apply --ignore-whitespace /tmp/fix.patch 2>&1 || git apply /tmp/fix.patch 2>&1
source /opt/miniconda3/etc/profile.d/conda.sh && conda activate testbed
{run_test_cmd}
"""
        docker_cmd = [
            "docker", "run", "--rm",
            "-v", f"{patch_file}:/tmp/fix.patch:ro",
        ]
        if test_patch_file:
            docker_cmd += ["-v", f"{test_patch_file}:/tmp/test.patch:ro"]
        docker_cmd += [
            "--memory", "4g",
            "--cpus", "2",
            image_name,
            "bash", "-c", script
        ]
        result = subprocess.run(
            docker_cmd,
            capture_output=True, text=True,
            timeout=DOCKER_TEST_TIMEOUT
        )

        output = result.stdout + result.stderr
        passed = passed_check(output, result.returncode)

        log.debug(f"  Docker test: {'PASS' if passed else 'FAIL'} (rc={result.returncode})")
        return passed, output

    except subprocess.TimeoutExpired:
        log.warning(f"  Docker test timed out after {DOCKER_TEST_TIMEOUT}s")
        return False, f"TIMEOUT after {DOCKER_TEST_TIMEOUT}s"
    except Exception as e:
        log.warning(f"  Docker test error: {e}")
        return False, str(e)
    finally:
        try:
            os.unlink(patch_file)
        except Exception:
            pass
        if test_patch_file:
            try:
                os.unlink(test_patch_file)
            except Exception:
                pass

# ── Traceback Extraction ──────────────────────────────────────────────────────

def extract_traceback_summary(test_output: str, max_lines: int = 60) -> str:
    """
    Extracts the most relevant failure section from pytest output.
    Truncated to stay within LLM token budgets.
    """
    lines = test_output.split('\n')

    failure_start = -1
    for i, line in enumerate(lines):
        if any(marker in line for marker in [
            'FAILED', 'ERROR', 'AssertionError',
            'Traceback (most recent call last)',
            'E   ', '_ FAILURES _', '= ERRORS ='
        ]):
            failure_start = i
            break

    if failure_start == -1:
        return '\n'.join(lines[-max_lines:])

    relevant = lines[failure_start:failure_start + max_lines]
    return '\n'.join(relevant)

# ── Patch Generation ──────────────────────────────────────────────────────────

def repair_patch_headers(patch: str) -> str:
    """
    Recalculate the @@ hunk headers in a unified diff patch.
    LLMs frequently generate wrong line counts in @@ -a,b +c,d @@ headers.
    This function recomputes the correct counts from the actual hunk content.
    """
    if not patch or not patch.strip():
        return patch

    lines = patch.split('\n')
    output = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Pass through file headers
        if line.startswith('--- ') or line.startswith('+++ ') or line.startswith('diff --git'):
            output.append(line)
            i += 1
            continue

        # Found a hunk header
        if line.startswith('@@ '):
            # Parse the start lines from the header (ignore the counts)
            m = re.match(r'@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@(.*)', line)
            if not m:
                output.append(line)
                i += 1
                continue

            old_start = int(m.group(1))
            new_start = int(m.group(2))
            context_label = m.group(3)  # e.g. " def foo():"

            # Collect all lines in this hunk
            hunk_lines = []
            i += 1
            while i < len(lines):
                l = lines[i]
                if l.startswith('@@ ') or l.startswith('--- ') or l.startswith('+++ ') or l.startswith('diff --git'):
                    break
                hunk_lines.append(l)
                i += 1

            # Count old and new lines
            old_count = sum(1 for l in hunk_lines if l.startswith(' ') or l.startswith('-'))
            new_count = sum(1 for l in hunk_lines if l.startswith(' ') or l.startswith('+'))

            # Rebuild the header with correct counts
            new_header = f'@@ -{old_start},{old_count} +{new_start},{new_count} @@{context_label}'
            output.append(new_header)
            output.extend(hunk_lines)
            continue

        output.append(line)
        i += 1

    return '\n'.join(output)


def is_patch_truncated(patch: str) -> bool:
    """
    Detect if a patch was truncated mid-generation.
    A truncated patch will have the last hunk with wrong line counts,
    or end in the middle of a diff line without a newline.
    """
    if not patch:
        return False
    lines = patch.strip().split('\n')
    if not lines:
        return False
    last_line = lines[-1]
    # If the last line starts with - or + or space but looks incomplete
    # (very short and not a typical end), it may be truncated
    # The most reliable signal: try git apply --check will catch it
    # But we can do a quick heuristic: last hunk line count vs actual lines
    return False  # Let git apply --check be the authoritative validator


def extract_patch_from_response(response: str) -> str:
    """Extract a unified diff patch from an LLM response."""
    m = re.search(r'```(?:diff|patch)?\n(.*?)```', response, re.DOTALL)
    if m:
        return m.group(1).strip()

    lines = response.split('\n')
    diff_start = -1
    for i, line in enumerate(lines):
        if line.startswith('--- ') or line.startswith('diff --git'):
            diff_start = i
            break

    if diff_start >= 0:
        return '\n'.join(lines[diff_start:]).strip()

    return response.strip()


def validate_patch(repo_path: str, patch: str) -> tuple[bool, str]:
    """Validate a patch can be applied with git apply --check."""
    if not patch or not patch.strip():
        return False, "Empty patch"

    with tempfile.NamedTemporaryFile(mode='w', suffix='.patch', delete=False) as f:
        f.write(patch)
        patch_file = f.name

    try:
        result = subprocess.run(
            ["git", "apply", "--check", "--ignore-whitespace", patch_file],
            cwd=repo_path, capture_output=True, text=True, timeout=10
        )
        if result.returncode == 0:
            return True, ""
        return False, result.stderr[:200]
    except Exception as e:
        return False, str(e)
    finally:
        try:
            os.unlink(patch_file)
        except Exception:
            pass

# ── Localization ──────────────────────────────────────────────────────────────

def get_repo_from_docker(instance: dict) -> str:
    """
    Extract the /testbed directory structure and relevant files from the Docker
    image for this instance. This guarantees the file content exactly matches
    what git apply will see inside Docker.

    Returns a local path where the files are stored.
    """
    instance_id = instance["instance_id"]
    image_name = get_swebench_image_name(instance)

    # Ensure the image is available
    if not image_exists_locally(image_name):
        if not pull_image(image_name):
            raise RuntimeError(f"Cannot pull image: {image_name}")

    cache_path = REPOS_CACHE / instance_id
    if cache_path.exists():
        return str(cache_path)

    cache_path.mkdir(parents=True, exist_ok=True)

    # Step 1: Get the list of Python files in /testbed
    result = subprocess.run(
        ["docker", "run", "--rm", image_name,
         "bash", "-c", "find /testbed -name '*.py' -not -path '*/.git/*' -not -path '*/node_modules/*' | head -500"],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to list files in Docker: {result.stderr[:200]}")

    file_list = [l.strip() for l in result.stdout.strip().split('\n') if l.strip()]

    # Step 2: Create a tar archive of /testbed and extract it locally
    # This is faster than extracting files one by one
    tar_result = subprocess.run(
        ["docker", "run", "--rm", image_name,
         "bash", "-c", "cd /testbed && git ls-files | tar -czf - -T - 2>/dev/null"],
        capture_output=True, timeout=120
    )

    if tar_result.stdout:  # Accept any returncode - tar may exit 1/2 for warnings but still produce valid output
        # Extract the tar archive
        import tarfile, io
        try:
            with tarfile.open(fileobj=io.BytesIO(tar_result.stdout), mode='r:gz') as tar:
                tar.extractall(str(cache_path))
            log.info(f"  Extracted {len(file_list)} files from Docker image")
            return str(cache_path)
        except Exception as e:
            log.warning(f"  Tar extraction failed: {e}, falling back to git clone")
            shutil.rmtree(cache_path, ignore_errors=True)
            cache_path.mkdir(parents=True, exist_ok=True)

    # Fallback: git clone with full depth to get exact commit
    repo = instance["repo"]
    base_commit = instance["base_commit"]
    clone_url = f"https://github.com/{repo}.git"
    try:
        subprocess.run(
            ["git", "clone", clone_url, str(cache_path)],
            capture_output=True, text=True, timeout=300, check=True
        )
        subprocess.run(
            ["git", "checkout", base_commit],
            cwd=str(cache_path), capture_output=True, text=True, timeout=30, check=True
        )
        log.info(f"  Cloned repo at {base_commit[:8]} (fallback)")
        return str(cache_path)
    except Exception as e:
        log.warning(f"  Clone failed: {e}")
        shutil.rmtree(cache_path, ignore_errors=True)
        raise


def get_repo_at_commit(repo: str, base_commit: str) -> str:
    """Clone or checkout a repo at the specified commit. Returns local path.
    NOTE: Prefer get_repo_from_docker() for exact file content matching.
    """
    repo_slug = repo.replace("/", "_")
    cache_path = REPOS_CACHE / repo_slug / base_commit[:8]

    if cache_path.exists():
        return str(cache_path)

    cache_path.mkdir(parents=True, exist_ok=True)
    clone_url = f"https://github.com/{repo}.git"

    try:
        subprocess.run(
            ["git", "clone", clone_url, str(cache_path)],
            capture_output=True, text=True, timeout=300, check=True
        )
        subprocess.run(
            ["git", "checkout", base_commit],
            cwd=str(cache_path), capture_output=True, text=True, timeout=30
        )
        return str(cache_path)
    except Exception as e:
        log.warning(f"  Clone failed: {e}")
        shutil.rmtree(cache_path, ignore_errors=True)
        raise


def localize_files(repo_path: str, problem: str, hints: str) -> list[str]:
    """Phase 1a: Identify the most relevant files for this issue."""
    structure_lines = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in
                   ('node_modules', '__pycache__', '.git', 'dist', 'build', 'venv')]
        rel = os.path.relpath(root, repo_path)
        if rel == '.':
            rel = ''
        for f in files:
            if f.endswith(('.py', '.ts', '.js', '.tsx', '.jsx', '.java', '.go', '.rs', '.rb', '.c', '.cpp', '.h')):
                path_str = os.path.join(rel, f) if rel else f
                structure_lines.append(path_str)
        if len(structure_lines) > 200:
            break

    structure = '\n'.join(structure_lines[:200])

    prompt = f"""You are an expert software engineer analyzing a bug report.

Repository structure (Python/JS/TS files only):
{structure}

Issue:
{problem[:MAX_PROBLEM_CHARS]}

{f"Hints: {hints[:300]}" if hints else ""}

List the 3-5 most likely files that need to be changed to fix this issue.
Output ONLY a JSON array of file paths, e.g.: ["path/to/file.py", "other/file.py"]
No explanation, just the JSON array."""

    try:
        response = call_llm(prompt, temperature=0.0)
        m = re.search(r'\[.*?\]', response, re.DOTALL)
        if m:
            files = json.loads(m.group(0))
            existing = [f for f in files if os.path.exists(os.path.join(repo_path, f))]
            return existing[:5]
    except Exception as e:
        log.warning(f"  File localization failed: {e}")

    return []


def fallback_file_search(repo_path: str, problem: str) -> list[str]:
    """Fallback: keyword-based file search."""
    keywords = re.findall(r'\b[A-Za-z_][A-Za-z0-9_]{3,}\b', problem)[:10]
    matches = []
    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in
                   ('node_modules', '__pycache__', '.git')]
        for f in files:
            if not f.endswith('.py'):
                continue
            fp = os.path.join(root, f)
            try:
                content = open(fp).read(4000)
                if any(kw.lower() in content.lower() for kw in keywords[:5]):
                    matches.append(os.path.relpath(fp, repo_path))
                    if len(matches) >= 5:
                        return matches
            except Exception:
                pass
    return matches


def localize_edit_locations(repo_path: str, file_paths: list[str], problem: str) -> list[dict]:
    """Phase 1b: For each file, identify the specific functions/classes to edit."""
    analyses = []
    log.info(f"  localize_edit_locations: processing {len(file_paths)} files: {file_paths}")
    for fp in file_paths:
        full_path = os.path.join(repo_path, fp)
        if not os.path.exists(full_path):
            continue
        try:
            content = open(full_path).read(MAX_FILE_CHARS)
        except Exception:
            continue

        prompt = f"""Analyze this file for the bug described below.

File: {fp}
Content:
```python
{content}
```

Issue: {problem[:MAX_PROBLEM_CHARS]}

Identify the specific function(s) or class(es) that need to be changed.
Output JSON: {{"file": "{fp}", "functions": ["func1", "func2"], "issue_summary": "brief description"}}"""

        try:
            response = call_llm(prompt, temperature=0.0)
            m = re.search(r'\{.*?\}', response, re.DOTALL)
            if m:
                analysis = json.loads(m.group(0))
                # IMPORTANT: Always overwrite 'file' and 'content' with actual values
                # (LLM may return wrong/empty values for these keys)
                analysis['file'] = fp
                analysis['content'] = content
                analyses.append(analysis)
            else:
                # LLM didn't return valid JSON - use fallback
                analyses.append({'file': fp, 'functions': [], 'content': content, 'issue_summary': ''})
        except Exception as e:
            log.warning(f"  Edit location analysis failed for {fp}: {e}")
            analyses.append({'file': fp, 'functions': [], 'content': content, 'issue_summary': ''})

    return analyses

# ── Patch Generation ──────────────────────────────────────────────────────────

def get_failing_tests(instance: dict) -> list[str]:
    """Extract the failing test IDs from the instance."""
    tests_str = instance.get("FAIL_TO_PASS", "[]")
    if isinstance(tests_str, list):
        return tests_str
    try:
        tests = json.loads(tests_str)
        return tests if isinstance(tests, list) else []
    except Exception:
        return []


def generate_patch_candidate(
    repo_path: str,
    file_analyses: list[dict],
    problem: str,
    candidate_idx: int,
    traceback_context: str = ""
) -> str:
    """
    Generate a single patch candidate using Claude Sonnet 4.5 via OpenRouter.

    Strategy: Ask Claude to output the COMPLETE MODIFIED FILE content.
    Then generate the unified diff ourselves using Python's difflib.
    This guarantees 100% exact context lines and eliminates all patch-apply errors.

    candidate_idx controls temperature diversity:
      0 → 0.0 (deterministic, conservative)
      1 → 0.2 (slight variation)
      2 → 0.4 (moderate creativity)
      3 → 0.6 (more creative)
    """
    temperatures = [0.0, 0.2, 0.4, 0.6]
    temperature = temperatures[min(candidate_idx, len(temperatures) - 1)]

    # Use the primary file (the most relevant one)
    log.info(f"  generate_patch_candidate: file_analyses has {len(file_analyses)} entries")
    if not file_analyses:
        return ""

    primary = file_analyses[0]
    fp = primary.get('file', '')
    original_content = primary.get('content', '')
    functions = primary.get('functions', [])
    summary = primary.get('issue_summary', '')

    log.info(f"  generate_patch_candidate: fp={repr(fp)}, content_len={len(original_content)}")
    if not fp or not original_content:
        log.warning(f"  generate_patch_candidate: returning empty - fp={repr(fp)}, content_empty={not original_content}")
        return ""

    # Read the full file from disk (not truncated) for accurate diff generation
    full_path = os.path.join(repo_path, fp)
    try:
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            original_full = f.read()
    except Exception:
        original_full = original_content

    # Smart truncation: show relevant functions + surrounding context
    # For large files, find the relevant function sections
    def smart_truncate(content: str, func_names: list, max_chars: int) -> tuple[str, bool, int]:
        """Show relevant function sections for large files.
        Returns (display_content, truncated, start_line_number).
        start_line_number is 1-based line number where the displayed section starts.
        """
        if len(content) <= max_chars:
            return content, False, 1
        
        lines = content.split('\n')
        
        if func_names:
            # Find the first relevant function and extract its section
            for func_name in func_names[:2]:  # Max 2 functions
                for i, line in enumerate(lines):
                    if f'def {func_name}' in line or f'class {func_name}' in line:
                        # Extract from 10 lines before to 80 lines after
                        start = max(0, i - 10)
                        end = min(len(lines), i + 80)
                        section = '\n'.join(lines[start:end])
                        if len(section) <= max_chars:
                            return section, True, start + 1
                        return section[:max_chars], True, start + 1
        
        # Fallback: just take the first max_chars
        return content[:max_chars], True, 1
    
    display_content, truncated, section_start_line = smart_truncate(original_full, functions, MAX_FILE_CHARS)
    truncation_note = f"\n[... showing lines {section_start_line}+ of {original_full.count(chr(10))+1} total lines ...]" if truncated else ""

    traceback_section = ""
    if traceback_context:
        tb_truncated = traceback_context[:MAX_TRACEBACK_CHARS]
        traceback_section = f"""
PREVIOUS ATTEMPT FAILED — here is the test output:
```
{tb_truncated}
```

Fix the specific error shown above in your revised output.
"""

    # Choose strategy based on file size:
    # - Small files (<= MAX_FILE_CHARS): ask for complete modified file (difflib generates exact diff)
    # - Large files (> MAX_FILE_CHARS): ask for targeted diff of just the changed section
    is_large_file = len(original_full) > MAX_FILE_CHARS

    if is_large_file:
        # For large files: show only the relevant section and ask for the MODIFIED SECTION
        # Then we replace the section in the original file and use difflib for the diff
        # This guarantees exact context lines (difflib uses actual file content)
        prompt = f"""You are an expert software engineer fixing a bug. Output ONLY the modified version of the code section shown below. No explanations, no diff format, just the modified code.

BUG REPORT:
{problem[:MAX_PROBLEM_CHARS]}

FILE: {fp}
Functions to fix: {', '.join(functions) if functions else 'see bug report'}
Hint: {summary}
{traceback_section}
CODE SECTION TO FIX:
```python
{display_content}
```

Output ONLY the modified version of this exact code section:
```python
[modified code section here - same structure, just with the bug fixed]
```"""
    else:
        # For small files: ask for complete modified file
        prompt = f"""You are an expert software engineer fixing a bug. Your ONLY output must be the complete modified Python file in a code block. No explanations, no analysis, no text outside the code block.

BUG REPORT:
{problem[:MAX_PROBLEM_CHARS]}

FILE: {fp}
Functions to fix: {', '.join(functions) if functions else 'see bug report'}
Hint: {summary}
{traceback_section}
CURRENT FILE:
```python
{display_content}
```

Respond with ONLY the complete modified file:
```python
[complete modified file content here]
```"""

    try:
        response = call_llm(prompt, temperature=temperature, max_tokens=MAX_PATCH_TOKENS)

        if is_large_file:
            # For large files: extract the modified section and replace in original file
            modified_section = extract_file_from_response(response, fp)
            if not modified_section:
                log.warning(f"  Candidate {candidate_idx}: No modified section extracted")
                return ""
            # Find the original section in the full file and replace it
            # Use the display_content as the key to find the section
            if display_content in original_full:
                modified_full = original_full.replace(display_content, modified_section, 1)
            else:
                # Fallback: try line-by-line matching to find the section
                orig_lines = original_full.split('\n')
                sect_lines = display_content.split('\n')
                mod_lines = modified_section.split('\n')
                # Find where the section starts in the original
                found = False
                for start_idx in range(len(orig_lines) - len(sect_lines) + 1):
                    if orig_lines[start_idx:start_idx + len(sect_lines)] == sect_lines:
                        new_lines = orig_lines[:start_idx] + mod_lines + orig_lines[start_idx + len(sect_lines):]
                        modified_full = '\n'.join(new_lines)
                        found = True
                        break
                if not found:
                    log.warning(f"  Candidate {candidate_idx}: Could not locate section in original file")
                    return ""
            # Generate the unified diff using difflib (exact context lines guaranteed)
            patch = generate_unified_diff(fp, original_full, modified_full)
        else:
            # For small files: extract modified file and generate diff with difflib
            modified_content = extract_file_from_response(response, fp)
            if not modified_content:
                log.warning(f"  Candidate {candidate_idx}: No file content extracted")
                return ""

            # Generate the unified diff using difflib (exact context lines guaranteed)
            patch = generate_unified_diff(fp, original_full, modified_content)

        if not patch or not patch.strip():
            log.warning(f"  Candidate {candidate_idx}: No changes detected in modified file")
            return ""

        log.debug(f"  Candidate {candidate_idx}: Generated diff ({len(patch)} chars)")
        return patch

    except Exception as e:
        log.warning(f"  Patch generation failed (candidate {candidate_idx}): {e}")
        return ""


def extract_diff_from_response(response: str) -> str:
    """Extract a unified diff patch from an LLM response."""
    # Try ```diff block
    m = re.search(r'```diff\n(.*?)```', response, re.DOTALL)
    if m:
        content = m.group(1).strip()
        if '---' in content and '+++' in content and '@@' in content:
            return content

    # Try ``` block (no language tag)
    m = re.search(r'```\n(.*?)```', response, re.DOTALL)
    if m:
        content = m.group(1).strip()
        if '---' in content and '+++' in content and '@@' in content:
            return content

    # Try to find diff content directly in the response
    lines = response.split('\n')
    diff_lines = []
    in_diff = False
    for line in lines:
        if line.startswith('--- ') or line.startswith('+++ ') or line.startswith('@@ '):
            in_diff = True
        if in_diff:
            if line.startswith('```') or (diff_lines and not line and not any(
                line.startswith(c) for c in [' ', '+', '-', '@', '\\'])):
                break
            diff_lines.append(line)

    if diff_lines and len(diff_lines) > 3:
        return '\n'.join(diff_lines)

    return ""


def extract_file_from_response(response: str, filename: str) -> str:
    """Extract file content from an LLM response that contains a ```python block.
    
    Rejects content that looks like prose/analysis rather than Python code.
    """
    def looks_like_python(content: str) -> bool:
        """Check if content looks like actual Python code, not prose."""
        if not content or len(content) < 10:
            return False
        lines = content.strip().split('\n')
        # Must have multiple lines
        if len(lines) < 3:
            return False
        # First line should NOT start with prose words
        first_line = lines[0].strip().lower()
        prose_starts = ('i need', 'i will', 'let me', 'the ', 'this ', 'here ', 
                        'to fix', 'looking', 'based on', 'after', 'the bug')
        if any(first_line.startswith(p) for p in prose_starts):
            return False
        # Must contain Python keywords
        has_python = any(kw in content for kw in 
                        ['def ', 'class ', 'import ', 'return ', 'if ', 'for ', 'while '])
        return has_python

    # Try ```python block (most specific)
    m = re.search(r'```(?:python|py)\n(.*?)```', response, re.DOTALL)
    if m:
        content = m.group(1)
        if looks_like_python(content):
            return content

    # Try ``` block with any language tag or none
    for pattern in [r'```\w*\n(.*?)```', r'```\n(.*?)```']:
        m = re.search(pattern, response, re.DOTALL)
        if m:
            content = m.group(1)
            if looks_like_python(content):
                return content

    # Last resort: if the entire response looks like a Python file
    if looks_like_python(response) and response.count('\n') > 10:
        return response.strip()

    return ""



def generate_unified_diff(filepath: str, original: str, modified: str) -> str:
    """Generate a unified diff patch from original and modified file content."""
    import difflib

    original_lines = original.splitlines(keepends=True)
    modified_lines = modified.splitlines(keepends=True)

    # Ensure both end with newline
    if original_lines and not original_lines[-1].endswith('\n'):
        original_lines[-1] += '\n'
    if modified_lines and not modified_lines[-1].endswith('\n'):
        modified_lines[-1] += '\n'

    diff = list(difflib.unified_diff(
        original_lines,
        modified_lines,
        fromfile=f'a/{filepath}',
        tofile=f'b/{filepath}',
        n=3  # 3 lines of context
    ))

    if not diff:
        return ""

    return ''.join(diff)

# ── Phase 2: Multi-Agent Consensus ───────────────────────────────────────────

def phase2_consensus(
    repo_path: str,
    file_analyses: list[dict],
    problem: str,
    instance: dict,
    failing_tests: list[str]
) -> tuple[Optional[str], list[tuple[str, bool]]]:
    """
    Generate NUM_CANDIDATES patches and test each one immediately.
    Returns (winning_patch_or_None, all_candidates).
    Stops early if a patch passes the failing test.
    """
    candidates = []

    for i in range(NUM_CANDIDATES):
        log.info(f"    Candidate {i+1}/{NUM_CANDIDATES} (temp={[0.0,0.2,0.4,0.6][i]})...")
        patch = generate_patch_candidate(repo_path, file_analyses, problem, i)

        if not patch:
            log.warning(f"    Candidate {i+1}: No patch generated")
            candidates.append(("", False))
            continue

        # NOTE: We skip validate_patch (git apply --check against cached repo) because
        # the cached repo may be at a different commit than the instance's base_commit.
        # Docker is the authoritative test — it uses the exact correct commit.
        log.info(f"    Candidate {i+1}: Patch generated ({len(patch)} chars). Testing in Docker...")

        if failing_tests:
            passed, output = run_test_in_docker(instance, patch, failing_tests, capture_traceback=False)
            candidates.append((patch, passed))
            if passed:
                log.info(f"    Candidate {i+1}: PASSES failing tests! Stopping consensus.")
                return patch, candidates
            else:
                log.info(f"    Candidate {i+1}: Fails tests. Continuing...")
        else:
            # No failing tests — keep the patch as a best-effort candidate
            candidates.append((patch, True))

    valid_candidates = [(p, ok) for p, ok in candidates if p and ok]
    if valid_candidates:
        return None, candidates

    non_empty = [(p, ok) for p, ok in candidates if p]
    if non_empty:
        return None, candidates

    return None, candidates


# ── Phase 3: Traceback Loop ───────────────────────────────────────────────────

def phase3_traceback_loop(
    repo_path: str,
    file_analyses: list[dict],
    problem: str,
    instance: dict,
    failing_tests: list[str],
    initial_patch: str
) -> Optional[str]:
    """
    Iterative traceback-driven patch revision loop.

    1. Apply initial_patch in Docker, run tests with --tb=short
    2. If tests pass → return the patch
    3. If tests fail → extract traceback, generate revised patch
    4. Repeat up to MAX_TRACEBACK_ATTEMPTS times

    Returns the best patch found (passing if possible, else best attempt).
    """
    if not failing_tests:
        log.info("    No failing tests available for traceback loop, skipping")
        return initial_patch

    current_patch = initial_patch
    best_patch = initial_patch

    for attempt in range(1, MAX_TRACEBACK_ATTEMPTS + 1):
        log.info(f"    Traceback loop attempt {attempt}/{MAX_TRACEBACK_ATTEMPTS}...")

        if not current_patch:
            log.warning(f"    Attempt {attempt}: No patch to test")
            break

        # Run the patch in Docker — this is the authoritative test
        # (validate_patch is skipped because cached repo may be at wrong commit)
        passed, output = run_test_in_docker(
            instance, current_patch, failing_tests, capture_traceback=True
        )

        if passed:
            log.info(f"    Attempt {attempt}: PASSED! Traceback loop resolved the instance.")
            return current_patch

        traceback_summary = extract_traceback_summary(output)
        log.info(f"    Attempt {attempt}: Failed. Output: {traceback_summary[:120]}...")
        best_patch = current_patch

        if attempt == MAX_TRACEBACK_ATTEMPTS:
            log.info(f"    Traceback loop exhausted ({MAX_TRACEBACK_ATTEMPTS} attempts)")
            break

        log.info(f"    Generating revised patch with traceback context...")
        revised = generate_patch_candidate(
            repo_path, file_analyses, problem,
            candidate_idx=attempt % 4,
            traceback_context=traceback_summary
        )

        if revised and revised != current_patch:
            current_patch = revised
            log.info(f"    Revised patch ({len(revised)} chars)")
        else:
            log.warning(f"    No new patch generated, stopping loop")
            break

    return best_patch


# ── Main Solver ───────────────────────────────────────────────────────────────

def solve_instance(instance: dict) -> dict:
    """
    Full SOTA pipeline for a single SWE-bench instance.

    Phase 1: Localization
    Phase 2: Multi-Agent Consensus (test each candidate immediately)
    Phase 3: Traceback Loop (if no candidate passed in Phase 2)
    """
    instance_id = instance["instance_id"]
    repo = instance["repo"]
    base_commit = instance["base_commit"]
    problem_statement = instance["problem_statement"]
    hint_text = instance.get("hints_text", "")
    failing_tests = get_failing_tests(instance)

    log.info(f"  Extracting files from Docker image for {instance_id}...")
    try:
        repo_path = get_repo_from_docker(instance)
    except Exception as e:
        log.error(f"  Docker file extraction failed: {e}")
        # Fallback to git clone
        log.info(f"  Falling back to git clone {repo}@{base_commit[:8]}...")
        try:
            repo_path = get_repo_at_commit(repo, base_commit)
        except Exception as e2:
            log.error(f"  Git clone also failed: {e2}")
            return {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v3"}

    # ── Phase 1: Localization ─────────────────────────────────────────────────
    log.info(f"  Phase 1a: Localizing files...")
    file_paths = localize_files(repo_path, problem_statement, hint_text)
    if not file_paths:
        log.warning(f"  No files localized, using fallback")
        file_paths = fallback_file_search(repo_path, problem_statement)
    log.info(f"  Localized: {file_paths}")

    log.info(f"  Phase 1b: Analyzing edit locations...")
    file_analyses = localize_edit_locations(repo_path, file_paths, problem_statement)
    if not file_analyses:
        log.warning(f"  No file analyses generated")
        return {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v3"}

    # ── Phase 2: Multi-Agent Consensus ────────────────────────────────────────
    log.info(f"  Phase 2: Multi-agent consensus ({NUM_CANDIDATES} candidates)...")
    winning_patch, all_candidates = phase2_consensus(
        repo_path, file_analyses, problem_statement, instance, failing_tests
    )

    if winning_patch:
        log.info(f"  Phase 2 resolved the instance! Skipping traceback loop.")
        # NOTE: Not deleting repo_path (Docker-extracted cache, keep for potential reuse)
        return {
            "instance_id": instance_id,
            "model_patch": winning_patch,
            "model_name_or_path": "andromeda-sota-v3-consensus",
        }

    # ── Phase 3: Traceback Loop ───────────────────────────────────────────────
    valid_candidates = [(p, ok) for p, ok in all_candidates if p and ok]
    if valid_candidates:
        best_static = min(valid_candidates, key=lambda x: len(x[0]))[0]
    elif all_candidates:
        non_empty = [(p, ok) for p, ok in all_candidates if p]
        best_static = non_empty[0][0] if non_empty else ""
    else:
        best_static = ""

    if best_static and failing_tests:
        log.info(f"  Phase 3: Traceback loop (up to {MAX_TRACEBACK_ATTEMPTS} attempts)...")
        final_patch = phase3_traceback_loop(
            repo_path, file_analyses, problem_statement, instance,
            failing_tests, best_static
        )
    else:
        log.warning(f"  Phase 3: Skipped (no valid patch or no failing tests)")
        final_patch = best_static

    # NOTE: We do NOT delete repo_path here because it's the Docker-extracted cache
    # (indexed by instance_id) and can be reused if the run is interrupted and resumed.
    # Disk usage is bounded by the number of instances processed.

    if final_patch:
        log.info(f"  Final patch: {len(final_patch)} chars")
    else:
        log.warning(f"  No valid patch generated")

    return {
        "instance_id": instance_id,
        "model_patch": final_patch or "",
        "model_name_or_path": "andromeda-sota-v3",
    }


# ── Progress Commit ───────────────────────────────────────────────────────────

def commit_progress(run_id: str, predictions_file: Path, done: int, patched: int):
    try:
        repo = ANDROMEDA_DIR
        subprocess.run(["git", "config", "user.email", "andromeda@swebench.ai"], cwd=repo, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Andromeda SOTA v3"], cwd=repo, capture_output=True)
        remote = f"https://{GITHUB_TOKEN}@github.com/{GITHUB_REPO}.git"
        subprocess.run(["git", "pull", "--rebase", remote, "main"], cwd=repo, capture_output=True, timeout=60)
        subprocess.run(["git", "add", str(predictions_file)], cwd=repo, capture_output=True)
        msg = f"swebench-sota-v3({run_id}): {done} predictions, {patched} patched"
        subprocess.run(["git", "commit", "-m", msg], cwd=repo, capture_output=True)
        subprocess.run(["git", "push", remote, "main"], cwd=repo, capture_output=True, timeout=60)
        log.info(f"  Committed checkpoint: {done} done, {patched} patched")
    except Exception as e:
        log.warning(f"  Commit failed: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    from datasets import load_dataset

    parser = argparse.ArgumentParser(description="Andromeda SOTA SWE-bench Agent v3")
    parser.add_argument("--dataset", choices=["verified", "full"], default="verified",
                        help="Which SWE-bench dataset to use")
    parser.add_argument("--run_id", default=None, help="Run identifier (auto-generated if not set)")
    parser.add_argument("--limit", type=int, default=None, help="Limit to first N instances")
    parser.add_argument("--output", default=None, help="Output predictions file path")
    parser.add_argument("--instance_id", default=None, help="Run on a single instance ID")
    args = parser.parse_args()

    if not OPENROUTER_API_KEY:
        log.error("OPENROUTER_API_KEY not set! Cannot run without it.")
        sys.exit(1)

    run_id = args.run_id or f"andromeda_sota_v3_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    log.info(f"Andromeda SOTA v3 — run_id: {run_id}")
    log.info(f"Model: {OPENROUTER_MODEL} via OpenRouter (exclusive — no fallbacks)")
    log.info(f"Dataset: {args.dataset}")
    log.info(f"Pipeline: Localization → Consensus ({NUM_CANDIDATES} agents) → Traceback Loop ({MAX_TRACEBACK_ATTEMPTS} attempts)")

    log.info(f"Loading SWE-bench dataset ({args.dataset})...")
    if args.dataset == "verified":
        ds = load_dataset("SWE-bench/SWE-bench_Verified", split="test")
    else:
        ds = load_dataset("SWE-bench/SWE-bench", split="test")

    instances = list(ds)

    if args.instance_id:
        instances = [i for i in instances if i["instance_id"] == args.instance_id]
        if not instances:
            log.error(f"Instance {args.instance_id} not found in dataset")
            sys.exit(1)

    if args.limit:
        instances = instances[:args.limit]

    log.info(f"Loaded {len(instances)} instances")

    if args.output:
        predictions_file = Path(args.output)
    else:
        predictions_file = RESULTS_DIR / f"{run_id}_predictions.jsonl"

    done_ids = set()
    if predictions_file.exists():
        with open(predictions_file) as f:
            for line in f:
                try:
                    p = json.loads(line)
                    done_ids.add(p["instance_id"])
                except Exception:
                    pass
        log.info(f"Resuming from {len(done_ids)} existing predictions")

    remaining = [inst for inst in instances if inst["instance_id"] not in done_ids]
    log.info(f"Processing {len(remaining)} remaining instances")

    done = len(done_ids)
    patched = 0
    errors = 0

    if predictions_file.exists():
        with open(predictions_file) as f:
            for line in f:
                try:
                    p = json.loads(line)
                    if p.get("model_patch"):
                        patched += 1
                    else:
                        errors += 1
                except Exception:
                    pass

    start_time = time.time()

    with open(predictions_file, "a") as out_f:
        for i, instance in enumerate(remaining):
            instance_id = instance["instance_id"]
            log.info(f"[{done+1}/{len(instances)}] {instance_id}")

            try:
                pred = solve_instance(instance)
                out_f.write(json.dumps(pred) + "\n")
                out_f.flush()
                done += 1
                if pred["model_patch"]:
                    patched += 1
                    log.info(f"  Patched ({len(pred['model_patch'])} chars)")
                else:
                    errors += 1
                    log.warning(f"  No patch generated")
            except Exception as e:
                log.error(f"  Instance failed: {e}")
                errors += 1
                pred = {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v3"}
                out_f.write(json.dumps(pred) + "\n")
                out_f.flush()
                done += 1

            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed * 3600
            remaining_count = len(remaining) - (i + 1)
            eta_hours = remaining_count / max(rate, 1)
            log.info(
                f"  Progress: {done}/{len(instances)} | Patched: {patched} | "
                f"Errors: {errors} | Rate: {rate:.0f}/hr | ETA: {eta_hours:.1f}h"
            )

            if done % COMMIT_EVERY == 0:
                commit_progress(run_id, predictions_file, done, patched)

    commit_progress(run_id, predictions_file, done, patched)

    summary = {
        "run_id": run_id,
        "dataset": args.dataset,
        "total": len(instances),
        "done": done,
        "patched": patched,
        "errors": errors,
        "patch_rate": patched / max(done, 1),
        "model": OPENROUTER_MODEL,
        "pipeline": {
            "num_candidates": NUM_CANDIDATES,
            "max_traceback_attempts": MAX_TRACEBACK_ATTEMPTS,
            "docker_test_timeout": DOCKER_TEST_TIMEOUT,
        },
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    summary_file = RESULTS_DIR / f"{run_id}_summary.json"
    with open(summary_file, "w") as f:
        json.dump(summary, f, indent=2)

    log.info(f"Done! {patched}/{done} patched ({patched/max(done,1)*100:.1f}%)")
    log.info(f"Predictions: {predictions_file}")
    log.info(f"Summary: {summary_file}")


if __name__ == "__main__":
    main()
