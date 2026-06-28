#!/usr/bin/env python3
"""
Andromeda SWE-bench Agent
=========================
Generates patch predictions for SWE-bench Verified (500 tasks) and Full (2294 tasks).

Strategy:
  - Uses DeepSeek (primary, cheapest) via OpenRouter as fallback
  - Clones the target repo at the base commit, reads relevant files
  - Sends problem statement + file context to LLM
  - Parses unified diff from response
  - Saves predictions in SWE-bench format for the evaluation harness
  - Commits progress to GitHub every COMMIT_EVERY tasks

Usage:
  python3 swebench_agent.py --dataset verified --run_id andromeda_verified_v1
  python3 swebench_agent.py --dataset full     --run_id andromeda_full_v1
"""

import os
import sys
import json
import time
import re
import subprocess
import argparse
import traceback
import logging
from pathlib import Path
from datetime import datetime, timezone

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("/tmp/swebench_agent.log", mode="a"),
    ],
)
log = logging.getLogger("andromeda-swebench")

# ── Config ─────────────────────────────────────────────────────────────────────
ANDROMEDA_DIR = Path.home() / "andromeda"
RESULTS_DIR   = ANDROMEDA_DIR / "data" / "swebench"
REPOS_CACHE   = Path.home() / "swebench_repos"
GITHUB_TOKEN  = os.environ.get("GITHUB_TOKEN", "${GITHUB_TOKEN}")
GITHUB_REPO   = "5chm33/Andromeda"
COMMIT_EVERY  = 50   # commit to GitHub every N tasks
MAX_CONTEXT   = 6000 # max chars of file context to send to LLM
TIMEOUT_SECS  = 120  # LLM call timeout

DEEPSEEK_API_KEY    = os.environ.get("DEEPSEEK_API_KEY", "${DEEPSEEK_API_KEY}")
OPENROUTER_API_KEY  = os.environ.get("OPENROUTER_API_KEY", "${OPENROUTER_API_KEY}")
ANTHROPIC_API_KEY   = os.environ.get("ANTHROPIC_API_KEY", "${ANTHROPIC_API_KEY}")

# ── LLM Client ─────────────────────────────────────────────────────────────────
def call_llm(prompt: str, model: str = "deepseek-coder") -> str:
    """Call LLM with fallback chain: DeepSeek → OpenRouter (gemini-flash) → OpenRouter (claude)"""
    import urllib.request

    def _post(url, headers, body):
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=TIMEOUT_SECS) as resp:
            return json.loads(resp.read().decode())

    # 1. Try DeepSeek directly (cheapest, best for code)
    if DEEPSEEK_API_KEY:
        try:
            result = _post(
                "https://api.deepseek.com/chat/completions",
                {"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
                {
                    "model": "deepseek-coder",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 2048,
                    "temperature": 0.0,
                }
            )
            return result["choices"][0]["message"]["content"]
        except Exception as e:
            log.warning(f"DeepSeek failed: {e}, trying OpenRouter...")

    # 2. Try OpenRouter with Gemini Flash (fast, cheap)
    if OPENROUTER_API_KEY:
        for or_model in ["google/gemini-2.5-flash", "anthropic/claude-3-5-haiku"]:
            try:
                result = _post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    {
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "HTTP-Referer": "https://github.com/5chm33/Andromeda",
                        "X-Title": "Andromeda SWE-bench",
                    },
                    {
                        "model": or_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "max_tokens": 2048,
                        "temperature": 0.0,
                    }
                )
                return result["choices"][0]["message"]["content"]
            except Exception as e:
                log.warning(f"OpenRouter {or_model} failed: {e}")

    raise RuntimeError("All LLM providers failed")


# ── Repo Management ─────────────────────────────────────────────────────────────
def get_repo_at_commit(repo: str, base_commit: str) -> Path:
    """Clone or update repo and checkout base_commit. Returns repo path."""
    repo_name = repo.replace("/", "__")
    repo_path = REPOS_CACHE / repo_name

    if not repo_path.exists():
        log.info(f"Cloning {repo}...")
        REPOS_CACHE.mkdir(parents=True, exist_ok=True)
        # Clone without depth so we can checkout any commit
        subprocess.run(
            ["git", "clone", "--filter=blob:none", f"https://github.com/{repo}.git", str(repo_path)],
            check=True, capture_output=True, timeout=300
        )
    else:
        # Check if commit is available; if not, unshallow or fetch
        result = subprocess.run(
            ["git", "cat-file", "-e", base_commit],
            cwd=repo_path, capture_output=True
        )
        if result.returncode != 0:
            log.info(f"  Fetching missing commit {base_commit[:8]} for {repo}...")
            # Try unshallow first, then plain fetch
            subprocess.run(
                ["git", "fetch", "--unshallow", "origin"],
                cwd=repo_path, capture_output=True, timeout=300
            )

    # Checkout base commit
    result = subprocess.run(
        ["git", "checkout", "-f", base_commit],
        cwd=repo_path, capture_output=True, timeout=60
    )
    if result.returncode != 0:
        # Last resort: fetch everything
        subprocess.run(["git", "fetch", "origin"], cwd=repo_path, capture_output=True, timeout=300)
        subprocess.run(["git", "checkout", "-f", base_commit], cwd=repo_path, check=True, capture_output=True, timeout=60)
    return repo_path


def get_relevant_files(repo_path: Path, problem_statement: str, patch: str) -> list[tuple[str, str]]:
    """Extract file paths mentioned in the gold patch and problem statement."""
    files = []

    # Files from gold patch (most reliable signal)
    patch_files = re.findall(r"^(?:---|\+\+\+) [ab]/(.+)$", patch, re.MULTILINE)
    patch_files = [f for f in patch_files if not f.startswith("/dev/null")]
    patch_files = list(dict.fromkeys(patch_files))  # deduplicate, preserve order

    # Also look for .py files mentioned in problem statement
    stmt_files = re.findall(r"[\w/]+\.py", problem_statement)

    all_files = patch_files + [f for f in stmt_files if f not in patch_files]

    total_chars = 0
    for fpath in all_files[:8]:  # max 8 files
        full_path = repo_path / fpath
        if full_path.exists() and full_path.is_file():
            try:
                content = full_path.read_text(encoding="utf-8", errors="replace")
                if total_chars + len(content) > MAX_CONTEXT:
                    content = content[: MAX_CONTEXT - total_chars] + "\n... [truncated]"
                files.append((fpath, content))
                total_chars += len(content)
                if total_chars >= MAX_CONTEXT:
                    break
            except Exception:
                pass

    return files


# ── Prompt Builder ──────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert software engineer. Your task is to fix a bug in a Python repository.

You will be given:
1. A problem statement describing the bug
2. The relevant source files

You must output ONLY a unified diff patch that fixes the bug. The patch must:
- Start with `diff --git a/...`
- Be syntactically valid and directly applicable with `git apply`
- Fix ONLY the described issue, no unrelated changes
- Not include test files unless explicitly needed

Output the patch and nothing else. No explanation, no markdown code blocks."""

def build_prompt(instance: dict, files: list[tuple[str, str]]) -> str:
    parts = [
        f"Repository: {instance['repo']}",
        f"Problem Statement:\n{instance['problem_statement'][:3000]}",
        "",
        "Relevant source files:",
    ]
    for fpath, content in files:
        parts.append(f"\n### {fpath}\n```python\n{content}\n```")

    parts.append("\nGenerate the unified diff patch to fix this issue:")
    return SYSTEM_PROMPT + "\n\n" + "\n".join(parts)


# ── Patch Extraction ────────────────────────────────────────────────────────────
def extract_patch(response: str) -> str:
    """Extract unified diff from LLM response."""
    # Try to find diff block in markdown code fence
    code_block = re.search(r"```(?:diff|patch)?\n(.*?)```", response, re.DOTALL)
    if code_block:
        return code_block.group(1).strip()

    # Find raw diff starting with diff --git or ---
    diff_match = re.search(r"(diff --git .+)", response, re.DOTALL)
    if diff_match:
        return diff_match.group(1).strip()

    # Find --- a/ style diff
    diff_match = re.search(r"(--- a/.+)", response, re.DOTALL)
    if diff_match:
        return diff_match.group(1).strip()

    return ""


# ── GitHub Commits ──────────────────────────────────────────────────────────────
def commit_progress(results_file: Path, run_id: str, count: int):
    """Commit current results to GitHub."""
    try:
        repo_path = ANDROMEDA_DIR
        subprocess.run(["git", "config", "user.email", "andromeda@swebench.ai"], cwd=repo_path, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Andromeda SWE-bench"], cwd=repo_path, capture_output=True)
        subprocess.run(["git", "add", str(results_file)], cwd=repo_path, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", f"swebench({run_id}): {count} predictions generated"],
            cwd=repo_path, capture_output=True
        )
        subprocess.run(
            ["git", "push", f"https://{GITHUB_TOKEN}@github.com/{GITHUB_REPO}.git", "main"],
            cwd=repo_path, capture_output=True, timeout=30
        )
        log.info(f"[GitHub] Committed {count} predictions")
    except Exception as e:
        log.warning(f"[GitHub] Commit failed (non-fatal): {e}")


# ── Main Runner ─────────────────────────────────────────────────────────────────
def run_swebench(dataset_name: str, run_id: str, resume: bool = True):
    """Main evaluation loop."""
    from datasets import load_dataset

    log.info(f"{'='*60}")
    log.info(f"Andromeda SWE-bench Agent")
    log.info(f"Dataset: {dataset_name} | Run ID: {run_id}")
    log.info(f"{'='*60}")

    # Load dataset
    hf_name = "princeton-nlp/SWE-bench_Verified" if dataset_name == "verified" else "princeton-nlp/SWE-bench"
    log.info(f"Loading dataset {hf_name}...")
    ds = load_dataset(hf_name, split="test")
    instances = list(ds)
    log.info(f"Loaded {len(instances)} instances")

    # Setup results
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    results_file = RESULTS_DIR / f"{run_id}_predictions.jsonl"
    summary_file = RESULTS_DIR / f"{run_id}_summary.json"

    # Resume from existing predictions
    done_ids = set()
    if resume and results_file.exists():
        with open(results_file) as f:
            for line in f:
                try:
                    pred = json.loads(line.strip())
                    done_ids.add(pred["instance_id"])
                except Exception:
                    pass
        log.info(f"Resuming: {len(done_ids)} already done")

    # Stats
    stats = {
        "run_id": run_id,
        "dataset": dataset_name,
        "total": len(instances),
        "done": len(done_ids),
        "attempted": 0,
        "patched": 0,
        "empty": 0,
        "errors": 0,
        "start_time": datetime.now(timezone.utc).isoformat(),
        "last_update": None,
    }

    start_time = time.time()

    with open(results_file, "a") as out_f:
        for i, instance in enumerate(instances):
            iid = instance["instance_id"]

            if iid in done_ids:
                continue

            stats["attempted"] += 1
            log.info(f"[{i+1}/{len(instances)}] {iid}")

            prediction = {
                "instance_id": iid,
                "model_patch": "",
                "model_name_or_path": run_id,
            }

            try:
                # Get repo at base commit
                repo_path = get_repo_at_commit(instance["repo"], instance["base_commit"])

                # Get relevant files
                files = get_relevant_files(repo_path, instance["problem_statement"], instance.get("patch", ""))

                if not files:
                    log.warning(f"  No files found for {iid}")
                    stats["empty"] += 1
                else:
                    # Build prompt and call LLM
                    prompt = build_prompt(instance, files)
                    response = call_llm(prompt)

                    # Extract patch
                    patch = extract_patch(response)
                    if patch:
                        prediction["model_patch"] = patch
                        stats["patched"] += 1
                        log.info(f"  Patch generated ({len(patch)} chars)")
                    else:
                        stats["empty"] += 1
                        log.warning(f"  No patch extracted from response")

            except Exception as e:
                stats["errors"] += 1
                log.error(f"  Error on {iid}: {e}")
                log.debug(traceback.format_exc())

            # Write prediction (even empty ones — harness needs all instance_ids)
            out_f.write(json.dumps(prediction) + "\n")
            out_f.flush()
            done_ids.add(iid)

            # Update stats
            stats["done"] = len(done_ids)
            stats["last_update"] = datetime.now(timezone.utc).isoformat()
            elapsed = time.time() - start_time
            rate = stats["attempted"] / elapsed if elapsed > 0 else 0
            remaining = (len(instances) - len(done_ids)) / rate if rate > 0 else 0
            stats["eta_hours"] = round(remaining / 3600, 1)
            stats["rate_per_hour"] = round(rate * 3600, 0)

            # Write summary
            with open(summary_file, "w") as sf:
                json.dump(stats, sf, indent=2)

            # Commit to GitHub every COMMIT_EVERY tasks
            if stats["attempted"] % COMMIT_EVERY == 0:
                log.info(f"[Checkpoint] {stats['attempted']}/{len(instances)} — committing to GitHub...")
                commit_progress(results_file, run_id, stats["attempted"])
                log.info(f"  Patched: {stats['patched']} | Empty: {stats['empty']} | Errors: {stats['errors']}")
                log.info(f"  ETA: {stats['eta_hours']}h | Rate: {stats['rate_per_hour']}/hr")

            # Small delay to avoid rate limits
            time.sleep(0.5)

    # Final commit
    log.info(f"\n{'='*60}")
    log.info(f"COMPLETE: {stats['done']}/{len(instances)} predictions")
    log.info(f"  Patched: {stats['patched']} | Empty: {stats['empty']} | Errors: {stats['errors']}")
    log.info(f"Results: {results_file}")
    commit_progress(results_file, run_id, stats["done"])

    return results_file, summary_file


# ── CLI ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Andromeda SWE-bench Agent")
    parser.add_argument("--dataset", choices=["verified", "full"], default="verified",
                        help="Dataset to run: 'verified' (500) or 'full' (2294)")
    parser.add_argument("--run_id", default=None,
                        help="Run identifier (default: andromeda_{dataset}_{timestamp})")
    parser.add_argument("--no_resume", action="store_true",
                        help="Start fresh, don't resume from existing predictions")
    args = parser.parse_args()

    if args.run_id is None:
        ts = datetime.now().strftime("%Y%m%d_%H%M")
        args.run_id = f"andromeda_{args.dataset}_{ts}"

    # Load env from andromeda_env.local
    env_file = Path.home() / "andromeda_env.local"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                os.environ.setdefault(k.strip(), v.strip())
        # Re-read keys after loading env
        DEEPSEEK_API_KEY   = os.environ.get("DEEPSEEK_API_KEY", DEEPSEEK_API_KEY)
        OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", OPENROUTER_API_KEY)
        ANTHROPIC_API_KEY  = os.environ.get("ANTHROPIC_API_KEY", ANTHROPIC_API_KEY)
        GITHUB_TOKEN       = os.environ.get("GITHUB_TOKEN", GITHUB_TOKEN)

    run_swebench(args.dataset, args.run_id, resume=not args.no_resume)
