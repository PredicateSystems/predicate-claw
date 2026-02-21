# Production Readiness Checklist

This document tracks production readiness criteria for the OpenClaw Predicate
Provider. All items must be verified before GA release.

**Status:** Ready for review
**Last Updated:** 2026-02-20
**Owner:** Platform Security

## 1. Security Posture

| Criteria | Status | Evidence |
|----------|--------|----------|
| Fail-closed default for high-risk actions | ✓ | `provider.ts` throws on sidecar errors |
| No embedded signing keys in plugin | ✓ | Keys remain in sidecar/control plane |
| Log redaction for sensitive values | ✓ | Tests in `audit-event-e2e.test.ts` |
| SecurityError returns redacted reasons | ✓ | `errors.ts` implementation |
| Path traversal protection | ✓ | Tests in `hack-vs-fix-demo.test.ts` |
| Prompt injection blocking | ✓ | Tests in `hack-vs-fix-demo.test.ts` |

**Security Signoff:** _________________ Date: _________

## 2. Reliability

| Criteria | Status | Evidence |
|----------|--------|----------|
| Circuit breaker for sidecar outages | ✓ | `circuit-breaker.ts` |
| Exponential backoff with jitter | ✓ | `calculateBackoff()` function |
| Configurable timeouts | ✓ | `config.ts` (300ms default) |
| Graceful degradation on sync failure | ✓ | Local policy evaluation continues |
| Load tested (100 sequential, 50 concurrent) | ✓ | `load-latency.test.ts` |

## 3. Observability

| Criteria | Status | Evidence |
|----------|--------|----------|
| Decision telemetry (allow/deny/error) | ✓ | `provider.ts` telemetry hooks |
| Latency metrics | ✓ | `load-latency.test.ts` p50/p95 |
| Circuit breaker state metrics | ✓ | `CircuitBreaker.getMetrics()` |
| Audit export integration | ✓ | `audit-event-e2e.test.ts` |
| Correlation IDs (session, tenant, trace) | ✓ | `multi-tenant-isolation.test.ts` |

## 4. SLOs and Alerting

| Criteria | Status | Evidence |
|----------|--------|----------|
| Latency SLOs defined (p50 <25ms, p95 <75ms) | ✓ | `docs/SLO_THRESHOLDS.md` |
| Availability SLOs defined (99.9%) | ✓ | `docs/SLO_THRESHOLDS.md` |
| Alert thresholds documented | ✓ | `docs/SLO_THRESHOLDS.md` |
| Circuit breaker alert thresholds | ✓ | `docs/SLO_THRESHOLDS.md` |
| Deny spike detection criteria | ✓ | `docs/SLO_THRESHOLDS.md` |

## 5. Operations

| Criteria | Status | Evidence |
|----------|--------|----------|
| Operational runbook | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |
| P1-P4 incident procedures | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |
| Health check endpoints | ✓ | Documented in runbook |
| Restart/recovery procedures | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |
| Credential rotation procedures | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |
| Scaling guidance | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |

## 6. Testing

| Criteria | Status | Evidence |
|----------|--------|----------|
| Unit tests | ✓ | 15 test files, all passing |
| Integration tests (sidecar wire format) | ✓ | `provider.test.ts` |
| Load/latency tests | ✓ | `load-latency.test.ts` |
| Multi-tenant isolation tests | ✓ | `multi-tenant-isolation.test.ts` |
| JWKS/key rotation tests | ✓ | `jwks-rotation.test.ts` |
| Adversarial/security tests | ✓ | `hack-vs-fix-demo.test.ts` |
| CI pipeline (Node 20/22) | ✓ | `.github/workflows/tests.yml` |

## 7. Documentation

| Criteria | Status | Evidence |
|----------|--------|----------|
| API contract documented | ✓ | Design doc action/resource mapping |
| Fail-open/fail-closed policy table | ✓ | Design doc |
| SLO documentation | ✓ | `docs/SLO_THRESHOLDS.md` |
| Operational runbook | ✓ | `docs/OPERATIONAL_RUNBOOK.md` |
| Docker adversarial test guide | ✓ | `examples/README.md` |

## 8. Control Plane Integration

| Criteria | Status | Evidence |
|----------|--------|----------|
| Policy sync client | ✓ | `control-plane-sync.ts` |
| Revocation propagation | ✓ | `control-plane-sync.ts` |
| Stale-sync observability | ✓ | `ControlPlaneSyncStatusTracker` |
| Audit export wiring | ✓ | `audit-event-e2e.test.ts` |

## 9. Known Limitations

| Limitation | Impact | Planned Fix |
|------------|--------|-------------|
| `state_hash` not integrated into auth flow | Limits pre-execution state verification | Post-Phase 4 |
| No automatic sidecar discovery | Requires manual `baseUrl` config | Future enhancement |

## Sign-off

### Engineering Review

- [ ] All test suites passing
- [ ] Code review completed
- [ ] Performance benchmarks acceptable

**Engineering Lead:** _________________ Date: _________

### Security Review

- [ ] Fail-closed behavior verified
- [ ] Log redaction verified
- [ ] No credential exposure risks

**Security Lead:** _________________ Date: _________

### Operations Review

- [ ] Runbook reviewed and validated
- [ ] Alerting configured
- [ ] On-call procedures documented

**Operations Lead:** _________________ Date: _________

### Final Approval

- [ ] All sections signed off
- [ ] No blocking issues
- [ ] Ready for GA release

**Release Manager:** _________________ Date: _________
