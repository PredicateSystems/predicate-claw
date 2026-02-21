# SLOs and Alert Thresholds

This document defines Service Level Objectives (SLOs) and alert thresholds for
the OpenClaw Predicate Provider in production deployments.

## Latency SLOs

### Authorization Call Latency

| Percentile | Target | Alert Threshold |
|------------|--------|-----------------|
| p50 | < 25 ms | > 50 ms |
| p95 | < 75 ms | > 150 ms |
| p99 | < 150 ms | > 300 ms |

These targets assume local sidecar deployment. For remote sidecar deployments,
add network RTT to each target.

### Sidecar Timeout

- **Default timeout:** 300 ms
- **Hard timeout (fail-closed):** 500 ms

If the sidecar does not respond within the timeout, the provider fails closed
(denies the action) for high-risk operations.

## Availability SLOs

### Provider Availability

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Uptime | 99.9% | < 99.5% |
| Error rate | < 0.1% | > 1% |

### Sidecar Availability

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Uptime | 99.95% | < 99.9% |
| Circuit breaker open rate | < 0.5% | > 2% |

## Decision Quality SLOs

### Deny Spike Detection

| Metric | Baseline | Alert Threshold |
|--------|----------|-----------------|
| Deny rate | ~5% (varies by policy) | > 2x baseline over 5 min |
| Deny rate spike | N/A | > 50% increase in 1 min |

A sudden spike in deny rates may indicate:
- Misconfigured policy rollout
- Attack attempt (should trigger investigation)
- Sidecar sync failure

### Reason Code Distribution

Monitor reason code distribution for anomalies:

| Reason Code | Expected Range | Alert if |
|-------------|----------------|----------|
| `denied_by_policy` | 80-95% of denials | < 70% |
| `sidecar_timeout` | < 1% | > 5% |
| `circuit_open` | < 0.5% | > 2% |
| `missing_context` | < 0.1% | > 1% |

## Circuit Breaker Thresholds

### Default Configuration

```typescript
{
  failureThreshold: 5,      // Opens after 5 consecutive failures
  resetTimeoutMs: 30_000,   // Attempts recovery after 30 seconds
  successThreshold: 2,      // Closes after 2 successful calls in half-open
}
```

### Alert Thresholds

| Event | Alert Level | Action |
|-------|-------------|--------|
| Circuit opened | Warning | Investigate sidecar health |
| Circuit open > 1 min | Critical | Page on-call |
| Circuit open > 5 min | Critical | Consider manual intervention |

## Telemetry and Audit SLOs

### Audit Export Latency

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Export delay (best-effort) | < 5 seconds | > 30 seconds |
| Export failure rate | < 1% | > 5% |

Note: Audit export is best-effort and should never block the authorization path.

### Telemetry Completeness

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Decision events captured | > 99.9% | < 99% |
| Context fields present | > 99% | < 95% |

## Control Plane Sync SLOs

### Policy Sync

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Sync interval | < 60 seconds | > 5 minutes |
| Stale policy age | < 5 minutes | > 15 minutes |

### Revocation Propagation

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Revocation latency | < 30 seconds | > 2 minutes |
| Revocation completeness | 100% | Any missed revocation |

## Monitoring Implementation

### Required Metrics

```typescript
// Authorization metrics
counter("predicate_auth_total", { outcome: "allow" | "deny" | "error" });
histogram("predicate_auth_latency_ms", { action: string });

// Circuit breaker metrics
gauge("predicate_circuit_state", { state: "closed" | "open" | "half_open" });
counter("predicate_circuit_transitions", { from: string, to: string });

// Sync metrics
gauge("predicate_policy_age_seconds");
counter("predicate_sync_failures");

// Audit metrics
counter("predicate_audit_exports", { status: "success" | "failure" });
histogram("predicate_audit_latency_ms");
```

### Dashboard Panels

1. **Authorization Overview**
   - Request rate by action
   - Allow/deny/error distribution
   - p50/p95/p99 latency

2. **Circuit Breaker Status**
   - Current state per sidecar
   - Transition history
   - Recovery time

3. **Sync Health**
   - Policy version timeline
   - Sync lag
   - Revocation propagation

4. **Deny Analysis**
   - Deny rate over time
   - Top deny reasons
   - Deny by tenant/action

## Incident Response

### P1: Circuit Breaker Stuck Open

1. Check sidecar health and logs
2. Verify network connectivity
3. Check control plane status
4. Consider manual circuit reset if sidecar is healthy

### P2: Elevated Deny Rate

1. Compare to policy change timeline
2. Check for attack patterns
3. Review deny reasons distribution
4. Validate policy sync status

### P3: Elevated Latency

1. Check sidecar resource usage
2. Review concurrent request load
3. Check control plane sync load
4. Consider scaling sidecars

## Review Cadence

- **Weekly:** Review latency percentiles and deny trends
- **Monthly:** Audit SLO compliance and adjust thresholds
- **Quarterly:** Review and update SLO targets based on operational learnings
