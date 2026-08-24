# lofigen-server

`lofigen-server` is the headless, local-only contract boundary between Lofiever and the
ACE-Step 1.5 runtime. This first slice exposes control-plane metadata and cooperative drain only.
It does **not** load model weights, generate audio, connect to PostgreSQL, or receive R2
credentials.

The implementation follows RFC 0001 and is pinned to ACE-Step commit
`14c0211d5a0653b0f63e27686f4c3f151b4d8629`.

## Public v1 contract

| Method | Route | Authentication | Success | Purpose |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/health` | public | `200` | Liveness and non-sensitive runtime state |
| `GET` | `/v1/capabilities` | HMAC-SHA256 | `200` | Machine and pinned-engine capabilities |
| `POST` | `/v1/admin/drain` | HMAC-SHA256 | `202` | Stop new admissions and preserve work already in flight |

Unknown routes return `404`. Authentication failures always return the same `401`
`authentication_failed` response. Invalid authenticated drain payloads return `400`; non-JSON
payloads return `415`; payloads over 1 KiB return `413`. Duplicate or combined critical content
headers return `400`, incomplete bodies return `400`, an expired request deadline returns `408`,
and a saturated handler pool returns `503`. Unexpected handler failures return a generic `500`
without exception text.

The machine-readable contracts live in
[`src/lofigen_server/contracts`](src/lofigen_server/contracts). The two disk fields in health are
intentional during protocol stabilization: `freeStagingBytes` is the RFC name and `freeDisk` is a
compatibility alias with the same byte value. Both come from `fstatvfs` on the staging root fd, so
renaming or replacing the configured pathname cannot redirect the metric. Health and capabilities
both report the same stable `workerId`.

This PR deliberately reports:

- `modelLoaded: false`;
- `generationAvailable: false`;
- `referenceAudio: false`;
- `modelId` and `modelRevision` as `null` unless metadata is explicitly configured.

Jobs, status polling, artifacts, cancellation, and the generation adapter are later protocol
slices. No placeholder route for them exists here.

## HMAC wire format

Protected requests carry these headers:

```text
X-Lofiever-Signature-Version: 1
X-Lofiever-Worker-Id: <configured workerId>
X-Lofiever-Timestamp: <Unix seconds>
X-Lofiever-Nonce: <16-128 ASCII letters, digits, underscore, or hyphen>
X-Lofiever-Signature: <lowercase hex HMAC-SHA256>
```

Each protected request must contain exactly one signature-version, worker-ID, timestamp, nonce,
and signature header. The signed worker ID must exactly equal the server's configured identity.
Drain requests must also contain exactly one `Content-Length` and one `Content-Type`; combined
values, duplicate fields, and `Transfer-Encoding` are rejected before body read. The timestamp is
the canonical unsigned decimal Unix-seconds representation (1-12 digits, with no leading zero
except `0`). Signature hex is strictly lowercase.

The signed bytes are UTF-8 for this exact newline-delimited message, with no trailing newline:

```text
LOFIEVER-HMAC-SHA256-V1
WORKER_ID
METHOD
/exact/path
TIMESTAMP
NONCE
SHA256_HEX_OF_EXACT_BODY_BYTES
```

The legacy five-line message without label and worker audience is intentionally rejected; PR-2
does not exist yet, so there is no unsafe compatibility fallback. A request signed for `m5-local`
fails on `m4-local` even if both machines were accidentally provisioned with identical key bytes.
That audience binding is defense in depth, not permission to share keys: provision one unique HMAC
key per worker, keep `LOFIGEN_WORKER_ID` stable, and rotate that worker's key independently.

The default timestamp window is ±300 seconds and cannot be configured above 300 seconds. A nonce
is accepted once inside that window. Accepted nonces are committed atomically to the bounded
SQLite ledger at `$LOFIGEN_RUN_DIR/hmac-nonces.sqlite3`. The ledger is shared by processes using
that run directory and survives restart. A nonce remains retained through
`signed_timestamp + window`, including the exact validity boundary; each admission removes only a
bounded batch of older rows and fails closed if the bounded ledger remains full or unavailable.

The key is read once at boot from `LOFIGEN_HMAC_KEY_FILE`. Boot fails when the file is missing,
shorter than 32 bytes, longer than 1024 bytes, a symlink, non-regular, not owned by the process
user, or readable by group/other. Every parent is checked against symlinks and group/world write
access while walking from the filesystem root with `dir_fd`, `O_DIRECTORY`, and `O_NOFOLLOW`.
The final key is opened relative to the already validated parent fd, validated with `fstat`, and
read from the same descriptor. Parent or final-path swaps cannot redirect the read. The key value
and key path are never returned or logged.

## Configuration

CLI arguments override their corresponding environment variables.

| Environment | CLI | Default / rule |
| --- | --- | --- |
| `LOFIGEN_BIND` | `--bind` | `127.0.0.1`; `0.0.0.0` is always rejected |
| `LOFIGEN_PORT` | `--port` | `8787` |
| `LOFIGEN_PROTOCOL_VERSION` | `--protocol-version` | `1`; only v1 major is accepted |
| `LOFIGEN_WORKER_ID` | `--worker-id` | required; stable signed HMAC audience, with no fallback identity |
| `LOFIGEN_STAGING_DIR` | `--staging-dir` | required existing `0700` directory owned by the process user |
| `LOFIGEN_RUN_DIR` | `--run-dir` | required existing `0700` directory owned by the process user |
| `LOFIGEN_HMAC_KEY_FILE` | `--hmac-key-file` | required `0600` regular file |
| `LOFIGEN_HMAC_WINDOW_SECONDS` | `--hmac-window-seconds` | `300`; allowed `1..300` |
| `LOFIGEN_ALLOW_NON_LOOPBACK` | `--allow-non-loopback` | `false`; explicit opt-in for a Tailscale address |
| `LOFIGEN_DEVICE` | `--device` | `mps` |
| `LOFIGEN_LM_BACKEND` | `--lm-backend` | `mlx` |
| `LOFIGEN_MODEL_ID` | `--model-id` | unset in this no-model slice |
| `LOFIGEN_MODEL_REVISION` | `--model-revision` | unset in this no-model slice |
| `LOFIGEN_VAE_CHUNK` | `--vae-chunk` | falls back to `ACESTEP_MLX_VAE_CHUNK`; otherwise `null` |
| `LOFIGEN_MAX_BATCH` | `--batch-ceiling` | `1`; accepted range `1..8` |
| `LOFIGEN_ACESTEP_URL` | `--acestep-url` | `http://127.0.0.1:8001`; loopback HTTP only |

Non-loopback bind opt-in permits only `100.64.0.0/10` or `fd7a:115c:a1e0::/48`, and only when the
exact address is reported by the local `tailscale ip` CLI. LAN, public, and another host's CGNAT
address are rejected. Missing/disconnected Tailscale CLI state fails closed. The default remains
loopback.

The HTTP server admits at most 16 request handlers and applies a five-second absolute deadline to
the entire request, including headers and a slowly dripped body. Shutdown waits for admitted
handlers, while that deadline prevents a partial client from holding shutdown indefinitely. Drain
still affects job admission only: jobs already counted by `DrainController` continue to completion.
Bind, SQLite, staging setup, serving, and shutdown failures emit only stable JSON error codes
(`runtime_start_failed`, `runtime_failed`, or `runtime_shutdown_failed`), never exception text,
tracebacks, `$HOME`, or configured paths.

See [`lofigen.example.env`](lofigen.example.env) for a value-free template.

## Reproducible local boot (without weights)

Use Python 3.11 or 3.12. The final local interpreters are 3.11.15 and 3.12.11.

```bash
cd lofigen-server
uv sync --frozen --python 3.12

umask 077
mkdir -p "$HOME/lofigen/staging" "$HOME/lofigen/run" "$HOME/lofigen/logs"
chmod 700 "$HOME/lofigen" "$HOME/lofigen/staging" "$HOME/lofigen/run" "$HOME/lofigen/logs"
openssl rand -hex 32 > "$HOME/lofigen/.hmac"
chmod 600 "$HOME/lofigen/.hmac"
# Run this independently on each worker. Never copy one worker's .hmac to another.

cp lofigen.example.env "$HOME/lofigen/lofigen.env"
# Replace only <user> and worker identity values in ~/lofigen/lofigen.env.

set -a
. "$HOME/lofigen/lofigen.env"
set +a
uv run lofigen-server --check-config
uv run lofigen-server
```

`--check-config` performs no model load and prints only bind, port, protocol version, worker ID,
and status. It does not print file paths or secrets.

## Q14 — adapter versus reimplementation

Decision: **thin adapter over the pinned `acestep-api` on `127.0.0.1:8001`**. Do not reimplement
ACE-Step generation.

Evidence in snapshot `14c0211d...`:

- `pyproject.toml` maps `acestep-api` to `acestep.api_server:main`;
- `acestep/api/server_cli.py` defaults to host `127.0.0.1`, port `8001`, one uvicorn worker, and
  exposes `--no-init` / `ACESTEP_NO_INIT`;
- `acestep/api/model_download.py` owns model discovery/download;
- the upstream API owns `/release_task`, `/query_result`, `/v1/models`, `/v1/audio`, and `/health`.

This slice validates `LOFIGEN_ACESTEP_URL` as loopback-only but does not call it. A later jobs PR
will translate the Lofiever v1 job contract to those upstream routes. The wrapper continues to
own HMAC, protocol versioning, staging IDs, drain, and redacted logs.

For a no-weight upstream smoke boot, the pinned snapshot supports:

```bash
cd "$HOME/lofigen/ACE-Step-1.5"
ACESTEP_NO_INIT=true ACESTEP_API_HOST=127.0.0.1 ACESTEP_API_PORT=8001 uv run acestep-api --no-init
```

This repository did not execute that command or install ACE-Step dependencies in PR-1.

## Q15 — cache isolation

There is no single ACE-Step variable that relocates every runtime cache in the pinned snapshot.
The precise answer is layered:

1. `acestep/api/model_download.py` calls Hugging Face `snapshot_download(...,
   local_dir=checkpoints)`. Hugging Face Hub 0.36.0 stores local-dir metadata under
   `checkpoints/.cache/huggingface`, so it stays inside the pinned clone.
2. Set `HF_HOME=$HOME/lofigen/hf-cache`, `HF_HUB_CACHE=$HF_HOME/hub`, and
   `HF_XET_CACHE=$HF_HOME/xet` before importing `huggingface_hub` to confine any residual Hub/Xet
   cache.
3. Set `ACESTEP_DOWNLOAD_SOURCE=huggingface` to choose Hugging Face first. This is **not** a hard
   disable: the pinned downloader falls back to ModelScope after a Hugging Face failure. Both
   ModelScope call shapes in the snapshot receive the same in-tree `local_dir`/`cache_dir`, but
   uninstall still checks the default ModelScope cache for unexpected residues.
4. `acestep/api/lifespan_runtime.py` keeps its own `.cache/acestep` under the ACE-Step project
   root. It separately honors `ACESTEP_TMPDIR`, `TRITON_CACHE_DIR`, and
   `TORCHINDUCTOR_CACHE_DIR`; no upstream variable moves the entire root cache.

Because the ACE-Step clone itself is installed under `$HOME/lofigen/ACE-Step-1.5`, both
`checkpoints/.cache/huggingface` and `.cache/acestep` remain under the uninstall tree. The explicit
Hub variables cover library-level residuals. Uninstall must still inspect for leftovers; it must
not claim total cleanup solely because `$HOME/lofigen` moved away.

Hugging Face's primary documentation for `HF_HOME`, `HF_HUB_CACHE`, and local-dir metadata:

- https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables
- https://huggingface.co/docs/huggingface_hub/guides/download

## Logs and staging

The server logs only a fixed allowlist: event, generated request ID, method, known route, status,
and elapsed milliseconds. It never logs request headers, request bodies, HMAC material, prompts,
email addresses, audio bytes, or configured absolute paths. Invalid payload responses are generic
and do not echo input.

`StagingRoot` accepts only ASCII slash-separated relative segments. It rejects absolute paths,
`.`/`..`, backslashes, NULs, percent-encoded punctuation, and symlink traversal. Its `resolve()`
result is a preview for diagnostics only and is **not** an I/O authorization. Future artifact I/O
must use `open_for_read()` or exclusive `open_for_write()`: those APIs hold the root directory fd,
walk each descendant with `dir_fd` + `O_NOFOLLOW`, and remain confined even if the configured root
or a descendant path is swapped after validation. Accepting a path from an upstream response is
prohibited. The staging root itself must already be owned by the process user with mode `0700`.

## Drain and rollback

Drain is cooperative and idempotent:

1. atomically stop new job admission;
2. keep every admitted job counted and running;
3. return `202` with the current `jobsInFlight`;
4. remain draining after the count reaches zero.

Rollback/uninstall procedure:

1. Disable the future Node flags `AI_MUSIC_LOCAL_ENABLED` and
   `AI_MUSIC_CAMPAIGN_ENABLED` (neither is changed by this PR).
2. Send an authenticated `POST /v1/admin/drain` and poll public `/v1/health` until
   `jobsInFlight == 0`.
3. Stop `lofigen-server` and `acestep-api` using the PIDs recorded by the operator under
   `$HOME/lofigen/run/`. Do not kill by broad process-name match.
4. If a LaunchAgent was installed in a later change, unload that exact label. PR-1 installs none.
5. Revoke/rotate the HMAC key before removing its local file.
6. Inspect for cache residues outside the tree:

   ```bash
   find "$HOME/.cache/huggingface" -maxdepth 4 -iname '*ace-step*' -print 2>/dev/null
   find "$HOME/.cache/modelscope" -maxdepth 4 -iname '*ace-step*' -print 2>/dev/null
   ```

7. Move the isolated tree to Trash for recoverable removal, after confirming the exact target:

   ```bash
   test -d "$HOME/lofigen"
   test ! -e "$HOME/.Trash/lofigen-uninstalled"
   mv "$HOME/lofigen" "$HOME/.Trash/lofigen-uninstalled"
   ```

8. Re-run the residue inspection and report anything found. Do not state “clean uninstall” while
   a residual path is unreviewed.

There is no migration, R2 object, PostgreSQL row, global macOS configuration, `launchd` install,
or model weight to roll back in PR-1.

## Verification

```bash
cd lofigen-server
uv sync --frozen --python 3.12
uv run python -m unittest discover -s tests -v
uv run --python 3.11 python -m unittest discover -s tests -v
```

CI builds and installs the wheel before running that suite on Python 3.11 and 3.12, without
`PYTHONPATH`, then loads all four packaged schemas and runs the installed `lofigen-server
--check-config` console entrypoint.

RED/green receipts are recorded in [`docs/TDD-EVIDENCE.md`](docs/TDD-EVIDENCE.md).
