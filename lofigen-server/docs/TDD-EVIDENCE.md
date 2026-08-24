# TDD evidence — lofigen-server PR-1

All commands ran from the isolated branch `feat/local-music-worker-contract` with
`PYTHONPATH=lofigen-server/src` and Python 3.12.7. Each RED commit contains the test before its
corresponding production change.

| Slice | RED evidence | RED commit | GREEN commit |
| --- | --- | --- | --- |
| CLI/env boot | `4 tests`, `4 failures`; subprocess reported `No module named lofigen_server` | `1ea4bcb` | `fd80ecb` |
| Health/capabilities | discovery error: `No module named 'lofigen_server.server'` | `5a07e6d` | `9050de7` |
| Cooperative drain | discovery error: `cannot import name 'DrainingError'` | `9c80f89` | `f4db332` |
| HTTP header semantics | lowercase signed headers returned `401`, expected `200` | `7e6cf7d` | `c226362` |
| Body bound | Python 3.12 raised `AttributeError: HTTPStatus.CONTENT_TOO_LARGE`; connection reset instead of `413` | `5a298c5` | `9728c4b` |
| Tailscale env opt-in | explicit `LOFIGEN_ALLOW_NON_LOOPBACK=true` still returned `non_loopback_requires_opt_in` | `6e910d5` | `cb36748` |
| Staging confinement | discovery error: `No module named 'lofigen_server.staging'` | `3b8028b` | `5f43bf3` |
| Packaged schemas | `FileNotFoundError` for `contracts/health.response.schema.json` | `592a61c` | `93f91c3` |
| v1/upstream boundary | v2 was accepted; `--acestep-url` was rejected as an unknown argument instead of a validated unsafe URL | `193d708` | `5a3e859` |

Focused GREEN after the last implementation slice:

```text
python3.12: Ran 23 tests ... OK
```

The final verification receipt may have a larger count as documentation/packaging checks are
added. This file does not claim full repository CI, model execution, or hardware benchmark.
