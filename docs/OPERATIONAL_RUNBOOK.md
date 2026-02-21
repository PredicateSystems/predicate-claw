# Operational Runbook

This runbook provides step-by-step procedures for operating and troubleshooting
the OpenClaw Predicate Provider in production environments.

## Quick Reference

| Incident Type | Severity | First Response |
|---------------|----------|----------------|
| Circuit breaker open | P1 | Check sidecar health |
| Elevated deny rate | P2 | Compare to policy changes |
| High latency | P3 | Check sidecar resources |
| Audit export failures | P4 | Check control plane connectivity |

## Prerequisites

Before using this runbook, ensure you have:

- Access to provider logs and metrics dashboards
- Access to sidecar logs (`predicate-authorityd`)
- Ability to restart provider/sidecar processes
- Contact information for on-call escalation

## Incident Response Procedures

### P1: Circuit Breaker Stuck Open

**Symptoms:**
- All authorization requests failing immediately
- `CircuitOpenError` in provider logs
- Metrics showing `predicate_circuit_state = open`

**Diagnosis Steps:**

1. **Check sidecar health**
   ```bash
   curl -s http://localhost:8787/health | jq .
   ```
   Expected: `{"status": "healthy"}`

2. **Check sidecar logs for errors**
   ```bash
   journalctl -u predicate-authorityd -n 100 --no-pager
   # or
   docker logs predicate-authorityd --tail 100
   ```

3. **Verify network connectivity**
   ```bash
   curl -w "@curl-format.txt" -s -o /dev/null http://localhost:8787/health
   ```

4. **Check control plane sync status**
   ```bash
   curl -s http://localhost:8787/v1/sync/status | jq .
   ```

**Resolution Steps:**

1. **If sidecar is unhealthy:**
   ```bash
   # Restart sidecar
   systemctl restart predicate-authorityd
   # or
   docker restart predicate-authorityd
   ```

2. **If sidecar is healthy but circuit is still open:**
   - Circuit will auto-recover after `resetTimeoutMs` (default: 30s)
   - For immediate recovery, restart the provider process

3. **If control plane sync is failing:**
   - Check control plane endpoint accessibility
   - Verify API credentials are valid
   - Check for control plane service incidents

**Escalation:**
- If not resolved in 5 minutes, page on-call engineer
- If sidecar restart doesn't help, escalate to platform team

---

### P2: Elevated Deny Rate

**Symptoms:**
- Sudden increase in deny decisions (>2x baseline)
- User reports of blocked actions
- `denied_by_policy` reason code spike

**Diagnosis Steps:**

1. **Check deny rate trend**
   ```bash
   # Query recent deny events
   curl -s "http://localhost:8787/v1/audit/decisions?outcome=deny&limit=50" | jq .
   ```

2. **Compare to recent policy changes**
   - Check control plane for recent policy deployments
   - Review policy version in metrics

3. **Identify affected actions/resources**
   ```bash
   # Group denials by action
   curl -s "http://localhost:8787/v1/audit/decisions?outcome=deny" | \
     jq -r '.items | group_by(.action) | map({action: .[0].action, count: length})'
   ```

4. **Check for attack patterns**
   - Look for repeated denials from same principal
   - Check for unusual resource patterns (path traversal, etc.)

**Resolution Steps:**

1. **If caused by policy change:**
   - Rollback to previous policy version via control plane
   - Or fix policy and redeploy

2. **If attack attempt:**
   - Document attack patterns
   - Consider adding rate limiting
   - Report to security team

3. **If false positives:**
   - Review policy rules for overly broad denials
   - Add specific allow rules for legitimate use cases

**Escalation:**
- If attack suspected, notify security team immediately
- If policy rollback needed, coordinate with policy owners

---

### P3: High Authorization Latency

**Symptoms:**
- p95 latency > 150ms
- Slow tool execution reported by users
- Timeout errors in logs

**Diagnosis Steps:**

1. **Check current latency percentiles**
   ```bash
   curl -s http://localhost:8787/metrics | grep predicate_auth_latency
   ```

2. **Check sidecar resource usage**
   ```bash
   # CPU and memory
   top -p $(pgrep predicate-authorityd)
   # or
   docker stats predicate-authorityd --no-stream
   ```

3. **Check control plane sync load**
   ```bash
   curl -s http://localhost:8787/v1/sync/status | jq '.last_sync_duration_ms'
   ```

4. **Check concurrent request volume**
   ```bash
   curl -s http://localhost:8787/metrics | grep predicate_auth_concurrent
   ```

**Resolution Steps:**

1. **If sidecar CPU is high:**
   - Check for runaway policy evaluation
   - Consider scaling sidecar resources
   - Review policy complexity

2. **If sync is slow:**
   - Check control plane latency
   - Consider increasing sync interval
   - Review policy size

3. **If high concurrent load:**
   - Consider horizontal scaling
   - Review request batching options
   - Check for retry storms

**Escalation:**
- If resources are maxed, request capacity increase
- If policy is too complex, work with policy team to optimize

---

### P4: Audit Export Failures

**Symptoms:**
- Missing audit events in control plane
- `audit_export_failure` in logs
- Non-zero `predicate_audit_failures` counter

**Diagnosis Steps:**

1. **Check export error logs**
   ```bash
   grep "audit.*error" /var/log/provider.log | tail -20
   ```

2. **Verify control plane connectivity**
   ```bash
   curl -s https://control-plane.example.com/health
   ```

3. **Check export queue depth**
   ```bash
   curl -s http://localhost:8787/metrics | grep predicate_audit_queue
   ```

**Resolution Steps:**

1. **If control plane unreachable:**
   - Check network/firewall rules
   - Verify TLS certificates
   - Check for control plane incidents

2. **If queue is backed up:**
   - Audit export is best-effort; auth continues working
   - Events will retry automatically
   - Check disk space for local buffer

3. **If credentials expired:**
   - Rotate API credentials
   - Update provider configuration
   - Restart provider

**Escalation:**
- Audit failures are P4 (non-blocking)
- Escalate only if prolonged (>1 hour) or compliance-critical

---

## Routine Operations

### Restarting the Provider

```bash
# Graceful restart (allows in-flight requests to complete)
systemctl reload openclaw-provider

# Full restart
systemctl restart openclaw-provider
```

### Rotating Credentials

1. Generate new credentials in control plane
2. Update provider configuration
3. Restart provider
4. Verify connectivity
5. Revoke old credentials

### Updating Policy

1. Deploy new policy to control plane
2. Monitor sync status on sidecars
3. Watch deny rate for anomalies
4. Rollback if issues detected

### Scaling Sidecars

For high-load environments:

1. Deploy additional sidecar instances
2. Configure load balancer
3. Update provider `baseUrl` to load balancer
4. Verify even distribution

---

## Health Checks

### Provider Health

```bash
# Local provider health
curl -s http://localhost:3000/health

# Expected response
{
  "status": "healthy",
  "sidecar": "connected",
  "circuit": "closed"
}
```

### Sidecar Health

```bash
# Sidecar health
curl -s http://localhost:8787/health

# Expected response
{
  "status": "healthy",
  "policy_version": "v1.2.3",
  "last_sync": "2026-02-20T12:00:00Z"
}
```

### End-to-End Check

```bash
# Test authorization flow
curl -X POST http://localhost:8787/v1/authorize \
  -H "Content-Type: application/json" \
  -d '{
    "principal": "test:health-check",
    "action": "health.check",
    "resource": "system"
  }'

# Expected: allow decision for health check action
```

---

## Monitoring Checklist

### Daily

- [ ] Review deny rate trends
- [ ] Check circuit breaker state
- [ ] Verify audit export completeness

### Weekly

- [ ] Review latency percentiles
- [ ] Check policy sync freshness
- [ ] Audit access logs

### Monthly

- [ ] Review and update SLO thresholds
- [ ] Test incident response procedures
- [ ] Update runbook with learnings

---

## Contact Information

| Role | Contact |
|------|---------|
| On-call engineer | PagerDuty: `predicate-oncall` |
| Platform team | Slack: `#predicate-platform` |
| Security team | Slack: `#security-incidents` |
| Control plane status | https://status.predicatesystems.ai |

---

## Appendix

### Useful Commands

```bash
# View real-time logs
journalctl -u predicate-authorityd -f

# Check process status
systemctl status predicate-authorityd

# View metrics
curl -s http://localhost:8787/metrics

# Force policy sync
curl -X POST http://localhost:8787/v1/sync/trigger

# Get current policy version
curl -s http://localhost:8787/v1/policy/version
```

### Log Locations

| Component | Log Path |
|-----------|----------|
| Provider | `/var/log/openclaw-provider/provider.log` |
| Sidecar | `/var/log/predicate-authorityd/sidecar.log` |
| Audit events | `/var/log/predicate-authorityd/audit.jsonl` |

### Configuration Files

| Component | Config Path |
|-----------|-------------|
| Provider | `/etc/openclaw-provider/config.yaml` |
| Sidecar | `/etc/predicate-authorityd/config.yaml` |
| Policy | Managed via control plane |
