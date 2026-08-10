#!/usr/bin/env python3
"""
Resolve Docker Hub manifest digests for all 113 holdout images via the Registry API.
This avoids pulling ~340GB of images by using the Docker Hub API HEAD request.
The manifest digest (docker-content-digest header) is identical to what
`docker inspect --format '{{index .RepoDigests 0}}'` returns after pulling.
"""

import json
import time
import subprocess
import sys
from pathlib import Path

RESERVED_MANIFEST = Path('/home/ubuntu/andromeda/data/swebench/multilingual_reserved_run.jsonl')
OUTPUT = Path('/home/ubuntu/andromeda/data/swebench/expected_image_digests.json')

def get_image(instance_id: str) -> str:
    return f"swebench/sweb.eval.x86_64.{instance_id.replace('__', '_1776_').lower()}:latest"

def get_repo_tag(image: str):
    # swebench/sweb.eval.x86_64.apache_1776_druid-13704:latest
    # -> repo = swebench/sweb.eval.x86_64.apache_1776_druid-13704, tag = latest
    parts = image.rsplit(':', 1)
    return parts[0], parts[1] if len(parts) > 1 else 'latest'

def get_auth_token(repo: str) -> str:
    """Get a Docker Hub auth token for the given repository."""
    import urllib.request
    url = f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull"
    with urllib.request.urlopen(url, timeout=15) as resp:
        data = json.loads(resp.read())
        return data['token']

def resolve_digest_api(image: str) -> str:
    """Resolve image digest via Docker Hub Registry API (no pull needed)."""
    import urllib.request
    repo, tag = get_repo_tag(image)
    token = get_auth_token(repo)
    
    url = f"https://registry-1.docker.io/v2/{repo}/manifests/{tag}"
    req = urllib.request.Request(url, method='HEAD')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Accept', 'application/vnd.docker.distribution.manifest.v2+json')
    
    with urllib.request.urlopen(req, timeout=15) as resp:
        digest = resp.headers.get('Docker-Content-Digest', '')
        if not digest:
            raise ValueError(f"No Docker-Content-Digest header in response for {image}")
        return digest

def resolve_digest_local(image: str) -> str:
    """Resolve digest from locally pulled image via docker inspect."""
    result = subprocess.run(
        ['docker', 'inspect', '--format', '{{index .RepoDigests 0}}', image],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode != 0:
        raise ValueError(f"docker inspect failed: {result.stderr}")
    out = result.stdout.strip()
    if '@' in out:
        return out.split('@')[-1]
    return out

# Load all 113 reserved instances
rows = [json.loads(l) for l in RESERVED_MANIFEST.read_text().splitlines() if l.strip()]
images = sorted(set(get_image(r['instance_id']) for r in rows))
print(f"Resolving digests for {len(images)} unique images...")

# Check which are already locally cached
cached_result = subprocess.run(
    ['docker', 'images', '--format', '{{.Repository}}:{{.Tag}}'],
    capture_output=True, text=True
)
cached = set(cached_result.stdout.strip().splitlines())

digests = {}
failed = []

for i, img in enumerate(images, 1):
    try:
        if img in cached:
            # Use local inspect (faster, no network needed)
            digest = resolve_digest_local(img)
            source = 'local'
        else:
            # Use Docker Hub API (no pull needed)
            digest = resolve_digest_api(img)
            source = 'api'
        
        if not digest.startswith('sha256:'):
            raise ValueError(f"Unexpected digest format: {digest}")
        
        digests[img] = digest
        print(f"  [{i:3d}/{len(images)}] ✓ {source:5s} {img.split('.')[-1][:40]:40s} -> {digest[:16]}...")
        
        # Small delay to avoid rate limiting
        if source == 'api':
            time.sleep(0.1)
            
    except Exception as e:
        failed.append((img, str(e)))
        print(f"  [{i:3d}/{len(images)}] ✗ FAILED {img}: {e}")

print(f"\nResolved: {len(digests)}/{len(images)}")
if failed:
    print(f"Failed: {len(failed)}")
    for img, err in failed:
        print(f"  {img}: {err}")

if len(digests) < len(images):
    print(f"\nERROR: Only resolved {len(digests)}/{len(images)} digests. Cannot proceed.")
    sys.exit(1)

# Save the digest map
OUTPUT.write_text(json.dumps(digests, indent=2, sort_keys=True) + '\n')
print(f"\nDigest map saved to {OUTPUT}")
print(f"Total: {len(digests)} digests")
