# TDD evidence — lofigen-server PR-1

All commands ran from the isolated branch `feat/local-music-worker-contract`. Initial slices used
`PYTHONPATH=lofigen-server/src` on Python 3.12.7; review-fix slices and the final installed-package
suite used Python 3.12.11 without `PYTHONPATH`. Each RED commit contains the test before its
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
| Durable replay ledger | `3 errors`: `ServerConfig` had no `run_dir`; cases specify restart, future-skew boundary, and two-server atomicity | `230da72` | `cb508fa` |
| Canonical HMAC metadata | giant decimal disconnected without response; all three duplicated auth headers and uppercase hex were accepted | `9089f76` | `eb77205` |
| Bounded HTTP handling | `5 errors`: no timeout/handler-limit seam; after idle timeout was added, a byte-drip still returned `202` instead of `408` | `2964ba5`, `1dce36e` | `9015336` |
| Local Tailscale bind | LAN, public, another host's CGNAT, and unavailable CLI cases returned success (`6 failures`) | `ce0c1eb` | `6c7e4b0` |
| HMAC key descriptor | parent permissions and symlinked parent were accepted; path swap loaded replacement bytes (`3 failures`) | `3d89c07` | `e42d838` |
| Race-safe staging I/O | `4 errors`: no fd-backed read/write/close API existed | `661340f` | `1bc0b63` |
| Installed-wheel CI | Python matrix, wheel install, packaged-schema smoke, and console smoke assertions failed (`2 failures`) | `711de45` | `3cebcb1` |
| Worker-bound HMAC audience | versioned M5 request returned `401`; health omitted `workerId` (`1 failure`, `1 error`) | `3f2a263` | `c524172` |
| Redacted runtime failures | bind/SQLite subprocesses emitted traceback output; staging/create and serve errors escaped (`4 errors`) | `095f123` | `b1f5caa` |
| Key-parent and staging config | swapping the validated key parent loaded attacker bytes; a `0750` staging root passed config (`2 failures`) | `970545a` | `51d0fd2` |
| Staging volume metric | closing the held fd still returned `200`, while moving the root pathname returned `500` (`2 failures`) | `c98f256` | `84d6a24` |
| Mandatory worker identity | missing worker identity and CI without `--worker-id` were accepted (`2 failures`) | `b93e565` | `9625d8a` |
| Runtime/path identity hardening | focused run: `14 tests`, `18 failures` across raw config, staging/run/database swaps, protected GET framing, key representation/ownership, schemas, cache contract, and CI | `8a9a061` | `a6aab07` |
| Direct server constructor validation | direct `LofigenHttpServer(...)` accepted a raw wildcard/short-key/oversized-window config and created runtime state (`1 failure`) | `1772cbe` | `0f6ba70` |
| Exact numeric config types | public config accepted booleans for port, HMAC window, VAE chunk, and batch ceiling (`1 test`, `4 failures`) | `8291ae8` | `6b35070` |
| HTTP safety limit types | public server kwargs accepted non-finite/fractional limits and `True`, creating runtime state instead of rejecting before side effects (`1 test`, `7 failures`) | `f977aa2` | `0bb677d` |

Focused GREEN after the last implementation slice:

```text
python3.12: Ran 75 tests in 18.667s ... OK
```

The final verification receipt may have a larger count as documentation/packaging checks are
added. This file does not claim full repository CI, model execution, or hardware benchmark.
