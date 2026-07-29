# @x500/wrap

Insured fetch primitive for x500. Classifies HTTP outcomes, prices premium/refund in **tinybars**, publishes settlement events, attaches `X-X500-*` headers.

## Covered-breach matrix

| Outcome | Covered | Premium | Refund |
|---------|---------|---------|--------|
| `ok` | yes | flat | 0 |
| `latency_breach` (`slow`) | yes | flat | imputed + flat |
| `server_error` | yes | flat | imputed + flat |
| `network_error` | yes | flat | imputed + flat |
| `client_error` | no | 0 | 0 |

Asset must be `0.0.0` (HBAR). Network must be `hedera:testnet`.
