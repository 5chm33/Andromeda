# Andromeda v6.37 — Kubernetes Deployment

This directory contains Kubernetes manifests for deploying Andromeda to production.

## Files

| File | Purpose |
|------|---------|
| `deployment.yaml` | Main app deployment (2 replicas, rolling update) |
| `service.yaml` | ClusterIP service + nginx Ingress with TLS |
| `hpa.yaml` | Horizontal Pod Autoscaler (2–10 pods, CPU/memory) |
| `pvc.yaml` | Persistent Volume Claim for `data/` directory |
| `secrets.yaml` | Secret template (do not commit real values) |

## Prerequisites

- Kubernetes 1.25+
- `kubectl` configured for your cluster
- nginx ingress controller
- cert-manager (for TLS)
- metrics-server (for HPA)

## Quick Deploy

```bash
# 1. Create secrets (replace with real values)
kubectl create secret generic andromeda-secrets \
  --from-literal=DEEPSEEK_API_KEY=sk-... \
  --from-literal=JWT_SECRET=$(openssl rand -base64 32) \
  --from-literal=DATABASE_URL=mysql://user:pass@host:3306/andromeda \
  --from-literal=REDIS_URL=redis://user:pass@host:6379 \
  --from-literal=POSTGRES_URL=postgres://user:pass@host:5432/andromeda

# 2. Apply all manifests
kubectl apply -f k8s/

# 3. Check deployment status
kubectl rollout status deployment/andromeda

# 4. Get the service URL
kubectl get ingress andromeda
```

## Updating the Image

```bash
# Build and push
docker build -t ghcr.io/5chm33/andromeda:latest .
docker push ghcr.io/5chm33/andromeda:latest

# Rolling update (zero-downtime)
kubectl rollout restart deployment/andromeda
kubectl rollout status deployment/andromeda
```

## Scaling

```bash
# Manual scale
kubectl scale deployment/andromeda --replicas=5

# HPA will auto-scale based on CPU/memory
kubectl get hpa andromeda
```

## Monitoring

```bash
# Pod status
kubectl get pods -l app=andromeda

# Logs
kubectl logs -l app=andromeda --tail=100 -f

# Health check
kubectl exec -it $(kubectl get pod -l app=andromeda -o name | head -1) -- curl localhost:3000/health
```
