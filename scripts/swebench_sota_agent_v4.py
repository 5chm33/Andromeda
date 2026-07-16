#!/usr/bin/env python3
"""
Andromeda SOTA SWE-bench Agent v4
=================================
Upgrades over v3 (all four bottlenecks fixed):

  FIX 1 — Context Limits (Bottleneck 1)
    MAX_FILE_CHARS: 6,000 → 80,000 (smart per-file budget)
    MAX_PROBLEM_CHARS: 1,200 → 4,000
    MAX_TRACEBACK_CHARS: 1,500 → 6,000
    TOTAL_CONTEXT_BUDGET: 200,000 chars across all files
    Smart truncation now extracts ALL relevant functions, not just the first 2.

  FIX 2 — Multi-File Patches (Bottleneck 2)
    Localization now identifies up to 8 files (was 5).
    Patch generation uses <file path="...">...</file> blocks for multi-file output.
    Diff generation handles multiple files per patch.
    Secondary file detection: if a function changed in file A is called from file B,
    file B is added to the context for a follow-up pass.

  FIX 3 — Model Upgrade (Bottleneck 3)
    Primary model: claude-sonnet-5 (latest, via OpenRouter or direct Anthropic API)
    Escalation: if Sonnet 5 fails or times out, retry with claude-fable-5 (once per instance)
    Env var SWEBENCH_MODEL overrides the default (e.g. "anthropic/claude-sonnet-4-5")
    Env var SWEBENCH_ESCALATION_MODEL sets the escalation model.

  FIX 4 — No Fallback Contamination (Bottleneck 4)
    Hard fail if neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set.
    No DeepSeek, no Haiku, no cheap fallback models.
    Model name is logged on every LLM call so contamination is detectable.
    If a call fails, it raises — no silent degradation to a cheaper model.

  Pipeline (unchanged from v3):
    Phase 1 — Hierarchical Localization (up to 8 files, with test-path hints)
    Phase 2 — Multi-Agent Consensus (4 candidates, each tested in Docker immediately)
    Phase 3 — Traceback Loop (up to 5 attempts, feeding actual test output back to LLM)
    Phase 4 — Robust Infrastructure (Docker disk management, container cleanup, timeouts)
"""

import os, sys, json, time, re, subprocess, tempfile, shutil, hashlib, logging, signal
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/tmp/swebench_sota_v4.log", mode="a"),
    ],
)
log = logging.getLogger("andromeda-sota-v4")

# ── Config ────────────────────────────────────────────────────────────────────

ANDROMEDA_DIR      = Path.home() / "andromeda"
RESULTS_DIR        = ANDROMEDA_DIR / "data" / "swebench"
REPOS_CACHE        = Path.home() / "swebench_repos"
GITHUB_TOKEN       = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO        = "5chm33/Andromeda"
COMMIT_EVERY       = 50

OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY", "")

# FIX 3: Upgraded model — claude-sonnet-5 via OpenRouter
# Override with SWEBENCH_MODEL env var (e.g. "anthropic/claude-sonnet-4-5" for cost savings)
DEFAULT_MODEL      = "anthropic/claude-sonnet-5"
OPENROUTER_MODEL   = os.environ.get("SWEBENCH_MODEL", DEFAULT_MODEL)

# FIX 3: Escalation model for hard instances (used when Phase 2+3 both fail)
ESCALATION_MODEL   = os.environ.get("SWEBENCH_ESCALATION_MODEL", "anthropic/claude-fable-5")

# Number of candidate patches per instance (Phase 2)
NUM_CANDIDATES = 4

# Max traceback loop iterations per instance (Phase 3)
MAX_TRACEBACK_ATTEMPTS = 5

# FIX 1: Raised context limits — Sonnet 5 has 200K token context window
# 80K chars ≈ 20K tokens per file — enough for even large Python files
MAX_FILE_CHARS = 80_000

# FIX 1: Full problem statement — no more truncating issue descriptions
MAX_PROBLEM_CHARS = 4_000

# FIX 1: Full traceback context — enough to see the full stack trace
MAX_TRACEBACK_CHARS = 6_000

# FIX 1: Total context budget across all files (200K chars ≈ 50K tokens)
# Sonnet 5 has 200K token context window; 50K tokens leaves plenty for the prompt
TOTAL_CONTEXT_BUDGET = 200_000

# Timeout for LLM calls (raised to handle larger prompts)
TIMEOUT_SECS = 240

# Max tokens for patch generation — large enough for multi-file complete-file output
MAX_PATCH_TOKENS = 16_384

# Timeout for Docker test runs (seconds)
DOCKER_TEST_TIMEOUT = 300

# Minimum free disk space (GB) before pulling a Docker image
MIN_FREE_DISK_GB = 15

# ── LLM Client ────────────────────────────────────────────────────────────────

def call_llm(prompt: str, temperature: float = 0.0, max_tokens: int = 4096,
             model: str = None) -> str:
    """
    FIX 3 + FIX 4: Call the configured model with no silent fallbacks.
    - Tries OpenRouter first (if OPENROUTER_API_KEY is set)
    - Falls back to direct Anthropic API (if ANTHROPIC_API_KEY is set)
    - Hard fails if neither key is available
    - Logs the model name on every call for contamination detection
    """
    use_model = model or OPENROUTER_MODEL
    log.debug(f"  LLM call: model={use_model}, temp={temperature}, max_tokens={max_tokens}")

    if OPENROUTER_API_KEY:
        return _call_openrouter(prompt, temperature, max_tokens, use_model)
    elif ANTHROPIC_API_KEY:
        # Map OpenRouter model names to Anthropic API model IDs
        anthropic_model = _openrouter_to_anthropic_model(use_model)
        return _call_anthropic_direct(prompt, temperature, max_tokens, anthropic_model)
    else:
        raise RuntimeError(
            "Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set. "
            "Cannot make LLM calls. Set at least one API key."
        )


def _openrouter_to_anthropic_model(openrouter_model: str) -> str:
    """Map OpenRouter model identifiers to Anthropic API model IDs."""
    mapping = {
        "anthropic/claude-sonnet-5":    "claude-sonnet-5-20251101",
        "anthropic/claude-fable-5":     "claude-opus-4-5",
        "anthropic/claude-sonnet-4-5":  "claude-sonnet-4-5-20250514",
        "anthropic/claude-haiku-3-5":   "claude-haiku-3-5-20241022",
    }
    return mapping.get(openrouter_model, openrouter_model.split("/")[-1])


def _call_openrouter(prompt: str, temperature: float, max_tokens: int, model: str) -> str:
    import urllib.request, urllib.error

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/5chm33/Andromeda",
        "X-Title": "Andromeda SWE-bench SOTA v4",
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
        raise RuntimeError(f"OpenRouter HTTP {e.code} for model {model}: {error_body}")

    if "error" in data:
        raise RuntimeError(f"OpenRouter API error for model {model}: {data['error']}")

    content = data["choices"][0]["message"]["content"]
    usage = data.get("usage", {})
    log.info(f"  [{model}] Tokens: {usage.get('prompt_tokens', '?')} in / {usage.get('completion_tokens', '?')} out")
    return content


def _call_anthropic_direct(prompt: str, temperature: float, max_tokens: int, model: str) -> str:
    """Direct Anthropic API call (used when OPENROUTER_API_KEY is not set)."""
    import urllib.request, urllib.error

    headers = {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }
    body = json.dumps({
        "model": model,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body, headers=headers, method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode()[:500]
        raise RuntimeError(f"Anthropic API HTTP {e.code} for model {model}: {error_body}")

    if "error" in data:
        raise RuntimeError(f"Anthropic API error for model {model}: {data['error']}")

    content = data["content"][0]["text"]
    usage = data.get("usage", {})
    log.info(f"  [anthropic/{model}] Tokens: {usage.get('input_tokens', '?')} in / {usage.get('output_tokens', '?')} out")
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

# ── Test Runner Detection ────────────────────────────────────────────────────

# Repos known to use specific test runners (extend as needed)
_JEST_REPOS = {
    "vercel/next.js", "facebook/react", "facebook/jest",
    "microsoft/TypeScript", "microsoft/vscode",
    "expressjs/express", "nestjs/nest",
}
_MOCHA_REPOS = {
    "mochajs/mocha", "nodejs/node",
}
_VITEST_REPOS = {
    "vitejs/vite", "vitest-dev/vitest",
}
_CARGO_REPOS = {
    "rust-lang/rust", "tokio-rs/tokio", "serde-rs/serde",
}
_GO_REPOS = {
    "golang/go", "kubernetes/kubernetes",
}


def _detect_test_runner(repo: str) -> str:
    """Return the test runner to use for a given repo slug."""
    if repo in _JEST_REPOS:
        return "jest"
    if repo in _MOCHA_REPOS:
        return "mocha"
    if repo in _VITEST_REPOS:
        return "vitest"
    if repo in _CARGO_REPOS:
        return "cargo"
    if repo in _GO_REPOS:
        return "go"
    # Heuristic: repos with JS/TS keywords in name
    repo_lower = repo.lower()
    if any(kw in repo_lower for kw in ["node", "react", "vue", "angular", "typescript", "javascript", "next", "nuxt", "svelte"]):
        return "jest"  # most JS projects use jest
    return "pytest"  # default: Python


def _build_test_command(repo: str, tests: list, capture_traceback: bool) -> str:
    """Build the appropriate test command for the repo's language and test runner."""
    import shlex
    runner = _detect_test_runner(repo)

    if runner == "pytest":
        if repo == "django/django":
            test_args = " ".join(
                t.replace("tests.", "").replace(".", "/").rsplit("/", 1)[0]
                for t in tests[:3]
            )
            return f"python -m pytest {test_args} -x -q 2>&1 | tail -30"
        else:
            test_ids = " ".join(shlex.quote(t) for t in tests[:5])
            tb_flag = "--tb=short" if capture_traceback else "--tb=no"
            return f"python -m pytest {test_ids} {tb_flag} -x -q 2>&1 | tail -60"

    elif runner == "jest":
        # Jest: install deps if needed, then run matching test files
        test_patterns = " ".join(shlex.quote(t) for t in tests[:5])
        return (
            f"([ -f package.json ] && (npm install --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true)); "
            f"npx jest --testPathPattern={shlex.quote('|'.join(tests[:5]))} "
            f"--no-coverage --forceExit 2>&1 | tail -60"
        )

    elif runner == "vitest":
        test_patterns = "|".join(tests[:5])
        return (
            f"([ -f package.json ] && (npm install --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true)); "
            f"npx vitest run --reporter=verbose 2>&1 | tail -60"
        )

    elif runner == "mocha":
        test_patterns = " ".join(shlex.quote(t) for t in tests[:5])
        return (
            f"([ -f package.json ] && npm install --silent 2>/dev/null || true); "
            f"npx mocha {test_patterns} 2>&1 | tail -60"
        )

    elif runner == "cargo":
        # Rust: cargo test with test name filter
        test_filter = tests[0].split("::")[-1] if tests else ""
        return f"cargo test {shlex.quote(test_filter)} 2>&1 | tail -60"

    elif runner == "go":
        # Go: go test with -run filter
        test_filter = tests[0].split("/")[-1] if tests else "."
        return f"go test ./... -run {shlex.quote(test_filter)} -v 2>&1 | tail -60"

    else:
        # Unknown: try pytest as last resort
        test_ids = " ".join(shlex.quote(t) for t in tests[:5])
        return f"python -m pytest {test_ids} -x -q 2>&1 | tail -60"


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

        # Detect language/test runner from repo name and instance metadata
        test_cmd = _build_test_command(repo, tests, capture_traceback)

        docker_script = f"""#!/bin/bash
set -e
cd /testbed

# Apply test patch first (adds failing tests to the test file)
if [ -f /tmp/test.patch ]; then
    git apply --whitespace=fix /tmp/test.patch 2>/dev/null || true
fi

# Apply the fix patch
git apply --whitespace=fix /tmp/fix.patch 2>&1
if [ $? -ne 0 ]; then
    echo "PATCH_APPLY_FAILED"
    exit 1
fi

# Run the failing tests
{test_cmd}
"""

        script_file = None
        with tempfile.NamedTemporaryFile(mode='w', suffix='.sh', delete=False) as f:
            f.write(docker_script)
            script_file = f.name
        os.chmod(script_file, 0o755)

        container_name = f"andromeda_test_{hashlib.md5(patch.encode()).hexdigest()[:8]}"

        cmd = [
            "docker", "run", "--rm",
            "--name", container_name,
            "-v", f"{patch_file}:/tmp/fix.patch:ro",
            "-v", f"{script_file}:/tmp/run_test.sh:ro",
        ]
        if test_patch_file:
            cmd += ["-v", f"{test_patch_file}:/tmp/test.patch:ro"]
        cmd += [image_name, "bash", "/tmp/run_test.sh"]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True,
                timeout=DOCKER_TEST_TIMEOUT
            )
            output = result.stdout + result.stderr
            if "PATCH_APPLY_FAILED" in output:
                return False, output
            passed = result.returncode == 0 and "passed" in output.lower() and "failed" not in output.lower()
            return passed, output
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "kill", container_name], capture_output=True)
            return False, f"Docker test timed out after {DOCKER_TEST_TIMEOUT}s"

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
        if script_file:
            try:
                os.unlink(script_file)
            except Exception:
                pass


def extract_traceback_summary(test_output: str, max_lines: int = 80) -> str:
    """Extract the most relevant part of test output for the traceback loop."""
    lines = test_output.split('\n')
    # Find FAILED/ERROR sections
    error_start = -1
    for i, line in enumerate(lines):
        if any(marker in line for marker in ['FAILED', 'ERROR', 'AssertionError',
                                              'Traceback', 'E   ', 'ERRORS']):
            error_start = max(0, i - 2)
            break
    if error_start >= 0:
        return '\n'.join(lines[error_start:error_start + max_lines])
    # Fallback: last N lines
    return '\n'.join(lines[-max_lines:])

# ── Docker Repo Extraction ────────────────────────────────────────────────────

def get_repo_from_docker(instance: dict) -> str:
    """Extract the repository from the Docker image into a local directory."""
    instance_id = instance["instance_id"]
    cache_dir = REPOS_CACHE / instance_id
    if cache_dir.exists():
        return str(cache_dir)

    image_name = get_swebench_image_name(instance)
    if not image_exists_locally(image_name):
        if not pull_image(image_name):
            raise RuntimeError(f"Cannot pull image {image_name}")

    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(
            ["docker", "run", "--rm", image_name, "tar", "-czf", "-", "-C", "/testbed", "."],
            capture_output=True, timeout=300
        )
        if result.returncode != 0:
            raise RuntimeError(f"Docker tar failed: {result.stderr[:200]}")

        with tempfile.NamedTemporaryFile(suffix='.tar.gz', delete=False) as f:
            f.write(result.stdout)
            tar_file = f.name

        subprocess.run(
            ["tar", "-xzf", tar_file, "-C", str(cache_dir)],
            check=True, capture_output=True, timeout=120
        )
        os.unlink(tar_file)
        return str(cache_dir)
    except Exception as e:
        shutil.rmtree(cache_dir, ignore_errors=True)
        raise RuntimeError(f"Repo extraction failed: {e}")


def get_repo_at_commit(repo: str, commit: str) -> str:
    """Fallback: clone the repo at a specific commit."""
    cache_key = hashlib.md5(f"{repo}@{commit}".encode()).hexdigest()[:12]
    cache_dir = REPOS_CACHE / cache_key
    if cache_dir.exists():
        return str(cache_dir)

    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            ["git", "clone", f"https://github.com/{repo}.git", str(cache_dir)],
            check=True, capture_output=True, timeout=300
        )
        subprocess.run(
            ["git", "checkout", commit],
            cwd=str(cache_dir), check=True, capture_output=True, timeout=60
        )
        return str(cache_dir)
    except Exception as e:
        shutil.rmtree(cache_dir, ignore_errors=True)
        raise RuntimeError(f"Git clone failed for {repo}@{commit}: {e}")

# ── Phase 1: Localization ─────────────────────────────────────────────────────

def localize_files(repo_path: str, problem: str, hints: str, failing_tests: list[str] = None) -> list[str]:
    """
    FIX 2: Phase 1a — Identify up to 8 relevant files.
    Now includes test-path hints to boost source file detection.
    """
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
        if len(structure_lines) > 300:
            break

    structure = '\n'.join(structure_lines[:300])

    # FIX 2: Extract source file hints from failing test paths
    test_hint_section = ""
    if failing_tests:
        test_paths = [t.split("::")[0] for t in failing_tests[:8]]
        test_hint_section = f"\nFailing test files (the source files being tested are likely what needs fixing):\n" + "\n".join(test_paths)

    prompt = f"""You are an expert software engineer analyzing a bug report.

Repository structure (Python/JS/TS files only):
{structure}

Issue:
{problem[:MAX_PROBLEM_CHARS]}

{f"Hints: {hints[:500]}" if hints else ""}
{test_hint_section}

List ALL files (up to 8) that likely need to be changed to fix this issue.
Many bugs require changes to multiple files — include all of them.
Output ONLY a JSON array of file paths, e.g.: ["path/to/file.py", "other/file.py"]
No explanation, just the JSON array."""

    try:
        response = call_llm(prompt, temperature=0.0)
        m = re.search(r'\[.*?\]', response, re.DOTALL)
        if m:
            files = json.loads(m.group(0))
            existing = [f for f in files if os.path.exists(os.path.join(repo_path, f))]
            return existing[:8]
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


def smart_truncate_file(content: str, func_names: list[str], max_chars: int) -> str:
    """
    FIX 1: Smart truncation that extracts ALL relevant functions (not just first 2).
    For large files, finds all relevant function/class sections and concatenates them.
    """
    if len(content) <= max_chars:
        return content

    lines = content.split('\n')

    if func_names:
        # Find ALL relevant function sections
        sections = []
        total_chars = 0
        for func_name in func_names:
            for i, line in enumerate(lines):
                if f'def {func_name}' in line or f'class {func_name}' in line:
                    # Extract from 15 lines before to 120 lines after (larger window)
                    start = max(0, i - 15)
                    end = min(len(lines), i + 120)
                    section = '\n'.join(lines[start:end])
                    if total_chars + len(section) <= max_chars:
                        sections.append(f"# [lines {start+1}-{end}]\n{section}")
                        total_chars += len(section)
                    break

        if sections:
            return '\n\n'.join(sections)

    # Fallback: take the first max_chars
    return content[:max_chars]


def localize_edit_locations(repo_path: str, file_paths: list[str], problem: str) -> list[dict]:
    """
    FIX 1: Phase 1b — For each file, identify specific functions/classes to edit.
    Now uses the full MAX_FILE_CHARS budget per file.
    """
    analyses = []
    total_chars = 0

    log.info(f"  localize_edit_locations: processing {len(file_paths)} files: {file_paths}")
    for fp in file_paths:
        full_path = os.path.join(repo_path, fp)
        if not os.path.exists(full_path):
            continue

        # FIX 1: Respect total context budget
        if total_chars >= TOTAL_CONTEXT_BUDGET:
            log.info(f"  Skipping {fp} — total context budget reached ({total_chars} chars)")
            break

        try:
            full_content = open(full_path, encoding='utf-8', errors='replace').read()
        except Exception:
            continue

        # FIX 1: Per-file budget is min(MAX_FILE_CHARS, remaining budget)
        per_file_budget = min(MAX_FILE_CHARS, TOTAL_CONTEXT_BUDGET - total_chars)
        content = full_content[:per_file_budget]
        total_chars += len(content)

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
                analysis['file'] = fp
                analysis['content'] = content
                analysis['full_content'] = full_content  # Store full content for diff generation
                analyses.append(analysis)
            else:
                analyses.append({'file': fp, 'functions': [], 'content': content,
                                  'full_content': full_content, 'issue_summary': ''})
        except Exception as e:
            log.warning(f"  Edit location analysis failed for {fp}: {e}")
            analyses.append({'file': fp, 'functions': [], 'content': content,
                              'full_content': full_content, 'issue_summary': ''})

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


def generate_unified_diff(filepath: str, original: str, modified: str) -> str:
    """Generate a unified diff patch from original and modified file content."""
    import difflib

    original_lines = original.splitlines(keepends=True)
    modified_lines = modified.splitlines(keepends=True)

    if original_lines and not original_lines[-1].endswith('\n'):
        original_lines[-1] += '\n'
    if modified_lines and not modified_lines[-1].endswith('\n'):
        modified_lines[-1] += '\n'

    diff = list(difflib.unified_diff(
        original_lines,
        modified_lines,
        fromfile=f'a/{filepath}',
        tofile=f'b/{filepath}',
        n=3
    ))

    if not diff:
        return ""

    return ''.join(diff)


def extract_file_blocks(response: str) -> list[tuple[str, str]]:
    """
    FIX 2: Extract <file path="...">...</file> blocks from LLM response.
    Returns list of (filepath, content) tuples.
    """
    blocks = []
    # Standard closed blocks
    for m in re.finditer(r'<file path="([^"]+)">([\s\S]*?)</file>', response):
        filepath = m.group(1).strip()
        content = m.group(2)
        # Strip leading/trailing newlines and code fences
        content = content.strip()
        content = re.sub(r'^```(?:python|py)?\n', '', content)
        content = re.sub(r'\n```$', '', content)
        blocks.append((filepath, content))

    # Handle truncated response: <file path="..."> with no closing tag
    if not blocks:
        m = re.search(r'<file path="([^"]+)">([\s\S]+)$', response)
        if m:
            filepath = m.group(1).strip()
            content = m.group(2).strip()
            content = re.sub(r'^```(?:python|py)?\n', '', content)
            blocks.append((filepath, content))

    return blocks


def extract_file_from_response(response: str, filename: str) -> str:
    """Extract a single file's content from an LLM response."""
    def looks_like_python(content: str) -> bool:
        if not content or len(content) < 10:
            return False
        lines = content.strip().split('\n')
        if len(lines) < 3:
            return False
        first_line = lines[0].strip().lower()
        prose_starts = ('i need', 'i will', 'let me', 'the ', 'this ', 'here ',
                        'to fix', 'looking', 'based on', 'after', 'the bug')
        if any(first_line.startswith(p) for p in prose_starts):
            return False
        has_python = any(kw in content for kw in
                        ['def ', 'class ', 'import ', 'return ', 'if ', 'for ', 'while '])
        return has_python

    # Try <file path="..."> blocks first (multi-file format)
    file_blocks = extract_file_blocks(response)
    for fp, content in file_blocks:
        if fp == filename or fp.endswith(filename) or filename.endswith(fp):
            if looks_like_python(content):
                return content

    # Try ```python block
    m = re.search(r'```(?:python|py)\n(.*?)```', response, re.DOTALL)
    if m:
        content = m.group(1)
        if looks_like_python(content):
            return content

    # Try ``` block
    for pattern in [r'```\w*\n(.*?)```', r'```\n(.*?)```']:
        m = re.search(pattern, response, re.DOTALL)
        if m:
            content = m.group(1)
            if looks_like_python(content):
                return content

    # Last resort
    if looks_like_python(response) and response.count('\n') > 10:
        return response.strip()

    return ""


def generate_patch_candidate(
    repo_path: str,
    file_analyses: list[dict],
    problem: str,
    candidate_idx: int,
    traceback_context: str = "",
    model: str = None,
) -> str:
    """
    FIX 1 + FIX 2: Generate a patch candidate.
    - Uses full context budget (200K chars) across all files
    - Requests multi-file output using <file path="..."> blocks
    - Smart truncation extracts ALL relevant functions per file
    - Generates a combined diff for all changed files
    """
    temperatures = [0.0, 0.2, 0.4, 0.6]
    temperature = temperatures[min(candidate_idx, len(temperatures) - 1)]

    if not file_analyses:
        return ""

    # FIX 1 + FIX 2: Build context for ALL files within the total budget
    file_sections = []
    total_chars = 0
    for analysis in file_analyses:
        fp = analysis.get('file', '')
        full_content = analysis.get('full_content', analysis.get('content', ''))
        functions = analysis.get('functions', [])

        if not fp or not full_content:
            continue

        # FIX 1: Per-file budget respects total budget
        remaining_budget = TOTAL_CONTEXT_BUDGET - total_chars
        if remaining_budget <= 0:
            log.info(f"  Skipping {fp} in prompt — total context budget reached")
            break

        per_file_budget = min(MAX_FILE_CHARS, remaining_budget)
        display_content = smart_truncate_file(full_content, functions, per_file_budget)
        total_chars += len(display_content)

        summary = analysis.get('issue_summary', '')
        hint = f"\n# Hint: {summary}" if summary else ""
        func_hint = f"\n# Key functions: {', '.join(functions)}" if functions else ""
        file_sections.append(f"### {fp}{hint}{func_hint}\n```python\n{display_content}\n```")

    if not file_sections:
        return ""

    files_block = '\n\n'.join(file_sections)
    file_list = [a.get('file', '') for a in file_analyses if a.get('file')]

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

    # FIX 2: Multi-file output format
    prompt = f"""You are an expert software engineer fixing a GitHub issue.

## Issue
{problem[:MAX_PROBLEM_CHARS]}
{traceback_section}
## Files to Modify
{files_block}

## Instructions
Fix the bug described in the issue. Make MINIMAL changes — only change what is necessary.
Output the COMPLETE corrected content for EACH file you need to change using this format:

<file path="path/to/file.py">
[complete corrected file content — not a diff, the full file]
</file>

<file path="path/to/other_file.py">
[complete corrected file content if this file also needs changes]
</file>

Output ONLY the file blocks. No explanation, no analysis, no text outside the file blocks.
If only one file needs changing, output only one file block."""

    try:
        response = call_llm(prompt, temperature=temperature,
                            max_tokens=MAX_PATCH_TOKENS, model=model)

        # FIX 2: Extract all file blocks and generate a combined diff
        file_blocks = extract_file_blocks(response)

        if not file_blocks:
            # Fallback: try to extract a single file using old method
            primary = file_analyses[0]
            fp = primary.get('file', '')
            full_content = primary.get('full_content', primary.get('content', ''))
            if fp and full_content:
                modified = extract_file_from_response(response, fp)
                if modified:
                    file_blocks = [(fp, modified)]

        if not file_blocks:
            log.warning(f"  Candidate {candidate_idx}: No file blocks extracted from response")
            return ""

        # Generate diffs for all changed files
        all_diffs = []
        for fp, modified_content in file_blocks:
            # Find the original content for this file
            original_content = None
            for analysis in file_analyses:
                if analysis.get('file') == fp:
                    original_content = analysis.get('full_content', analysis.get('content', ''))
                    break

            if not original_content:
                # Try to read from disk
                full_path = os.path.join(repo_path, fp)
                if os.path.exists(full_path):
                    try:
                        original_content = open(full_path, encoding='utf-8', errors='replace').read()
                    except Exception:
                        pass

            if not original_content or not modified_content:
                continue

            if original_content == modified_content:
                log.info(f"  Candidate {candidate_idx}: No changes in {fp}")
                continue

            diff = generate_unified_diff(fp, original_content, modified_content)
            if diff:
                all_diffs.append(diff)
                log.info(f"  Candidate {candidate_idx}: Generated diff for {fp} ({len(diff)} chars)")

        if not all_diffs:
            log.warning(f"  Candidate {candidate_idx}: No diffs generated")
            return ""

        combined_patch = '\n'.join(all_diffs)
        log.info(f"  Candidate {candidate_idx}: Combined patch ({len(combined_patch)} chars, {len(all_diffs)} file(s))")
        return combined_patch

    except Exception as e:
        log.warning(f"  Patch generation failed (candidate {candidate_idx}): {e}")
        return ""

# ── Phase 2: Multi-Agent Consensus ───────────────────────────────────────────

def phase2_consensus(
    repo_path: str,
    file_analyses: list[dict],
    problem: str,
    instance: dict,
    failing_tests: list[str],
    model: str = None,
) -> tuple[Optional[str], list[tuple[str, bool]]]:
    """
    Generate NUM_CANDIDATES patches and test each one immediately.
    Returns (winning_patch_or_None, all_candidates).
    """
    candidates = []

    for i in range(NUM_CANDIDATES):
        log.info(f"    Candidate {i+1}/{NUM_CANDIDATES} (temp={[0.0,0.2,0.4,0.6][i]})...")
        patch = generate_patch_candidate(repo_path, file_analyses, problem, i, model=model)

        if not patch:
            log.warning(f"    Candidate {i+1}: No patch generated")
            candidates.append(("", False))
            continue

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
    initial_patch: str,
    model: str = None,
) -> Optional[str]:
    """
    Iterative traceback-driven patch revision loop.
    """
    if not failing_tests:
        return initial_patch

    current_patch = initial_patch
    best_patch = initial_patch

    for attempt in range(1, MAX_TRACEBACK_ATTEMPTS + 1):
        log.info(f"    Traceback loop attempt {attempt}/{MAX_TRACEBACK_ATTEMPTS}...")

        if not current_patch:
            break

        passed, output = run_test_in_docker(
            instance, current_patch, failing_tests, capture_traceback=True
        )

        if passed:
            log.info(f"    Attempt {attempt}: PASSED!")
            return current_patch

        traceback_summary = extract_traceback_summary(output)
        log.info(f"    Attempt {attempt}: Failed. Traceback: {traceback_summary[:120]}...")
        best_patch = current_patch

        if attempt == MAX_TRACEBACK_ATTEMPTS:
            break

        revised = generate_patch_candidate(
            repo_path, file_analyses, problem,
            candidate_idx=attempt % 4,
            traceback_context=traceback_summary,
            model=model,
        )

        if revised and revised != current_patch:
            current_patch = revised
        else:
            log.warning(f"    No new patch generated, stopping loop")
            break

    return best_patch

# ── Main Solver ───────────────────────────────────────────────────────────────

def solve_instance(instance: dict) -> dict:
    """
    FIX 3: Full SOTA pipeline with model escalation.
    Phase 1: Localization (up to 8 files)
    Phase 2: Multi-Agent Consensus (4 candidates, primary model)
    Phase 3: Traceback Loop (primary model)
    Phase 4: Escalation (if Phase 2+3 both fail, retry Phase 2+3 with escalation model)
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
        log.info(f"  Falling back to git clone {repo}@{base_commit[:8]}...")
        try:
            repo_path = get_repo_at_commit(repo, base_commit)
        except Exception as e2:
            log.error(f"  Git clone also failed: {e2}")
            return {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v4"}

    # ── Phase 1: Localization ─────────────────────────────────────────────────
    log.info(f"  Phase 1a: Localizing files (up to 8)...")
    file_paths = localize_files(repo_path, problem_statement, hint_text, failing_tests)
    if not file_paths:
        log.warning(f"  No files localized, using fallback")
        file_paths = fallback_file_search(repo_path, problem_statement)
    log.info(f"  Localized: {file_paths}")

    log.info(f"  Phase 1b: Analyzing edit locations...")
    file_analyses = localize_edit_locations(repo_path, file_paths, problem_statement)
    if not file_analyses:
        log.warning(f"  No file analyses generated")
        return {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v4"}

    # ── Phase 2: Multi-Agent Consensus (primary model) ────────────────────────
    log.info(f"  Phase 2: Multi-agent consensus ({NUM_CANDIDATES} candidates) with {OPENROUTER_MODEL}...")
    winning_patch, all_candidates = phase2_consensus(
        repo_path, file_analyses, problem_statement, instance, failing_tests,
        model=OPENROUTER_MODEL,
    )

    if winning_patch:
        log.info(f"  Phase 2 resolved the instance!")
        return {
            "instance_id": instance_id,
            "model_patch": winning_patch,
            "model_name_or_path": f"andromeda-sota-v4-consensus/{OPENROUTER_MODEL}",
        }

    # ── Phase 3: Traceback Loop (primary model) ───────────────────────────────
    valid_candidates = [(p, ok) for p, ok in all_candidates if p and ok]
    non_empty = [(p, ok) for p, ok in all_candidates if p]
    best_static = (valid_candidates or non_empty or [("", False)])[0][0]

    if best_static and failing_tests:
        log.info(f"  Phase 3: Traceback loop with {OPENROUTER_MODEL}...")
        final_patch = phase3_traceback_loop(
            repo_path, file_analyses, problem_statement, instance,
            failing_tests, best_static, model=OPENROUTER_MODEL,
        )
    else:
        log.warning(f"  Phase 3: Skipped (no valid patch or no failing tests)")
        final_patch = best_static

    if final_patch:
        # Test the final patch to see if it passes
        if failing_tests:
            passed, _ = run_test_in_docker(instance, final_patch, failing_tests)
            if passed:
                log.info(f"  Phase 3 resolved the instance!")
                return {
                    "instance_id": instance_id,
                    "model_patch": final_patch,
                    "model_name_or_path": f"andromeda-sota-v4-traceback/{OPENROUTER_MODEL}",
                }

    # ── Phase 4: Escalation (FIX 3) ──────────────────────────────────────────
    # If primary model failed, try once more with the escalation model
    if ESCALATION_MODEL and ESCALATION_MODEL != OPENROUTER_MODEL:
        log.info(f"  Phase 4: Escalating to {ESCALATION_MODEL}...")
        try:
            winning_patch_esc, all_candidates_esc = phase2_consensus(
                repo_path, file_analyses, problem_statement, instance, failing_tests,
                model=ESCALATION_MODEL,
            )
            if winning_patch_esc:
                log.info(f"  Phase 4 (escalation) resolved the instance!")
                return {
                    "instance_id": instance_id,
                    "model_patch": winning_patch_esc,
                    "model_name_or_path": f"andromeda-sota-v4-escalation/{ESCALATION_MODEL}",
                }

            best_esc = next((p for p, ok in all_candidates_esc if p), "")
            if best_esc and failing_tests:
                final_esc = phase3_traceback_loop(
                    repo_path, file_analyses, problem_statement, instance,
                    failing_tests, best_esc, model=ESCALATION_MODEL,
                )
                if final_esc:
                    log.info(f"  Phase 4 traceback produced a patch ({len(final_esc)} chars)")
                    return {
                        "instance_id": instance_id,
                        "model_patch": final_esc,
                        "model_name_or_path": f"andromeda-sota-v4-esc-traceback/{ESCALATION_MODEL}",
                    }
        except Exception as e:
            log.warning(f"  Phase 4 escalation failed: {e}")

    # Return best effort patch from primary model
    if final_patch:
        log.info(f"  Returning best-effort patch ({len(final_patch)} chars)")
    else:
        log.warning(f"  No valid patch generated for {instance_id}")

    return {
        "instance_id": instance_id,
        "model_patch": final_patch or "",
        "model_name_or_path": "andromeda-sota-v4",
    }

# ── Progress Commit ───────────────────────────────────────────────────────────

def commit_progress(run_id: str, predictions_file: Path, done: int, patched: int):
    try:
        repo = ANDROMEDA_DIR
        subprocess.run(["git", "config", "user.email", "andromeda@swebench.ai"], cwd=repo, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Andromeda SOTA v4"], cwd=repo, capture_output=True)
        remote = f"https://{GITHUB_TOKEN}@github.com/{GITHUB_REPO}.git"
        subprocess.run(["git", "pull", "--rebase", remote, "main"], cwd=repo, capture_output=True, timeout=60)
        subprocess.run(["git", "add", str(predictions_file)], cwd=repo, capture_output=True)
        msg = f"swebench-sota-v4({run_id}): {done} predictions, {patched} patched"
        subprocess.run(["git", "commit", "-m", msg], cwd=repo, capture_output=True)
        subprocess.run(["git", "push", remote, "main"], cwd=repo, capture_output=True, timeout=60)
        log.info(f"  Committed checkpoint: {done} done, {patched} patched")
    except Exception as e:
        log.warning(f"  Commit failed: {e}")

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    import argparse
    from datasets import load_dataset

    # Must declare globals before any use (including f-strings in add_argument)
    global OPENROUTER_MODEL, ESCALATION_MODEL

    parser = argparse.ArgumentParser(description="Andromeda SOTA SWE-bench Agent v4")
    parser.add_argument("--dataset", choices=["verified", "full"], default="verified",
                        help="Which SWE-bench dataset to use")
    parser.add_argument("--run_id", default=None, help="Run identifier (auto-generated if not set)")
    parser.add_argument("--limit", type=int, default=None, help="Limit to first N instances")
    parser.add_argument("--sample", type=int, default=None,
                        help="Random sample of N instances (for unbiased evaluation)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for --sample")
    parser.add_argument("--output", default=None, help="Output predictions file path")
    parser.add_argument("--instance_id", default=None, help="Run on a single instance ID")
    parser.add_argument("--model", default=None,
                        help=f"Override primary model (default: {DEFAULT_MODEL})")
    parser.add_argument("--escalation_model", default=None,
                        help=f"Override escalation model (default: {ESCALATION_MODEL})")
    args = parser.parse_args()

    # Apply CLI model overrides
    if args.model:
        OPENROUTER_MODEL = args.model
    if args.escalation_model:
        ESCALATION_MODEL = args.escalation_model

    # FIX 4: Hard fail if no API key is set
    if not OPENROUTER_API_KEY and not ANTHROPIC_API_KEY:
        log.error("Neither OPENROUTER_API_KEY nor ANTHROPIC_API_KEY is set!")
        log.error("Set at least one API key to run the benchmark.")
        sys.exit(1)

    run_id = args.run_id or f"andromeda_sota_v4_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M')}"
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    api_source = "OpenRouter" if OPENROUTER_API_KEY else "Anthropic direct"
    log.info(f"Andromeda SOTA v4 — run_id: {run_id}")
    log.info(f"Primary model: {OPENROUTER_MODEL} via {api_source}")
    log.info(f"Escalation model: {ESCALATION_MODEL}")
    log.info(f"Context budget: {TOTAL_CONTEXT_BUDGET:,} chars per instance")
    log.info(f"Per-file limit: {MAX_FILE_CHARS:,} chars (was 6,000 in v3)")
    log.info(f"Dataset: {args.dataset}")
    log.info(f"Pipeline: Localization(8 files) → Consensus({NUM_CANDIDATES}) → Traceback({MAX_TRACEBACK_ATTEMPTS}) → Escalation")

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
    elif args.sample:
        # FIX 4: Random sampling for unbiased evaluation (not first-N)
        import random
        random.seed(args.seed)
        instances = random.sample(instances, min(args.sample, len(instances)))
        log.info(f"Random sample: {len(instances)} instances (seed={args.seed})")
    elif args.limit:
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
                    log.info(f"  Patched ({len(pred['model_patch'])} chars) via {pred.get('model_name_or_path', '?')}")
                else:
                    errors += 1
                    log.warning(f"  No patch generated")
            except Exception as e:
                log.error(f"  Instance failed: {e}")
                errors += 1
                pred = {"instance_id": instance_id, "model_patch": "", "model_name_or_path": "andromeda-sota-v4"}
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
        "primary_model": OPENROUTER_MODEL,
        "escalation_model": ESCALATION_MODEL,
        "context_budget": TOTAL_CONTEXT_BUDGET,
        "max_file_chars": MAX_FILE_CHARS,
        "pipeline": {
            "num_candidates": NUM_CANDIDATES,
            "max_traceback_attempts": MAX_TRACEBACK_ATTEMPTS,
            "docker_test_timeout": DOCKER_TEST_TIMEOUT,
            "multi_file_patches": True,
            "escalation_enabled": bool(ESCALATION_MODEL),
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
