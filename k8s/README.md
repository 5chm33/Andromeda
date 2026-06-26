# Andromeda v45.4.0 — Kubernetes Deployment

This directory contains Kubernetes manifests for deploying Andromeda to production with high availability, auto-scaling, and zero-downtime rolling updates.

## Files

| File | Purpose |
|------|---------|
| `deployment.yaml` | Main app deployment (2 replicas, rolling update strategy) |
| `service.yaml` | ClusterIP service + nginx Ingress with TLS termination |
| `hpa.yaml` | Horizontal Pod Autoscaler (2–10 pods, CPU/memory triggers) |
| `pvc.yaml` | Persistent Volume Claim for `data/` and RSI state directories |
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
  --from-literal=GITHUB_TOKEN=ghp_...

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
docker build -t ghcr.io/5chm33/andromeda:v45.4.0 .
docker push ghcr.io/5chm33/andromeda:v45.4.0

# Rolling update (zero-downtime)
kubectl set image deployment/andromeda andromeda=ghcr.io/5chm33/andromeda:v45.4.0
kubectl rollout status deployment/andromeda
```

## Scaling

```bash
# Manual scale
kubectl scale deployment/andromeda --replicas=5

# HPA will auto-scale based on CPU/memory thresholds
kubectl get hpa andromeda
```

## Monitoring

```bash
# Pod status
kubectl get pods -l app=andromeda

# Logs (follow)
kubectl logs -l app=andromeda --tail=100 -f

# Health check
kubectl exec -it $(kubectl get pod -l app=andromeda -o name | head -1) \
  -- curl localhost:3000/health

# RSI Command Center (port-forward for local access)
kubectl port-forward svc/andromeda 3000:3000
# Then open http://localhost:3000/rsi
```

## RSI State Persistence

Andromeda's RSI daemon writes state to the `data/` directory. The PVC ensures this persists across pod restarts. In a multi-replica setup, use a `ReadWriteMany` storage class (e.g., NFS, EFS) to share state across pods.

## Notes on v45.4.0

- The `autonomousDeployment` module now supports Prometheus metrics and canary traffic splitting natively
- The `selfHealingArchitecture` module will automatically attempt recovery if a pod enters a crash loop
- The `perpetualStatePersistence` module checkpoints RSI state every 60 seconds to the PVC
