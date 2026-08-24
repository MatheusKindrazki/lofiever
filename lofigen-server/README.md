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
payloads return `415`; payloads over 1 KiB return `413`.

The machine-readable contracts live in
[`src/lofigen_server/contracts`](src/lofigen_server/contracts). The two disk fields in health are
intentional during protocol stabilization: `freeStagingBytes` is the RFC name and `freeDisk` is a
compatibility alias with the same byte value.

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
X-Lofiever-Timestamp: <Unix seconds>
X-Lofiever-Nonce: <16-128 ASCII letters, digits, underscore, or hyphen>
X-Lofiever-Signature: <lowercase hex HMAC-SHA256>
```

The signed bytes are UTF-8 for this exact newline-delimited message, with no trailing newline:

```text
METHOD
/exact/path
TIMESTAMP
NONCE
SHA256_HEX_OF_EXACT_BODY_BYTES
```

The default timestamp window is ±300 seconds and cannot be configured above 300 seconds. A nonce
is accepted once inside that window. The replay cache is process-local and bounded because this
server runs exactly one process. Before enabling multiple server processes, replace it with a
shared durable nonce store; do not run multiple workers with independent replay caches.

The key is read once at boot from `LOFIGEN_HMAC_KEY_FILE`. Boot fails when the file is missing,
shorter than 32 bytes, longer than 1024 bytes, a symlink, non-regular, or readable by group/other.
The key value and key path are never returned or logged.

## Configuration

CLI arguments override their corresponding environment variables.

| Environment | CLI | Default / rule |
| --- | --- | --- |
| `LOFIGEN_BIND` | `--bind` | `127.0.0.1`; `0.0.0.0` is always rejected |
| `LOFIGEN_PORT` | `--port` | `8787` |
| `LOFIGEN_PROTOCOL_VERSION` | `--protocol-version` | `1`; only v1 major is accepted |
| `LOFIGEN_WORKER_ID` | `--worker-id` | `local-worker`; non-sensitive stable identifier |
| `LOFIGEN_STAGING_DIR` | `--staging-dir` | required existing writable directory; no symlink |
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

Non-loopback bind opt-in does not permit wildcard or multicast binds. It exists for an explicit
Tailscale unicast address; the default remains loopback.

See [`lofigen.example.env`](lofigen.example.env) for a value-free template.

## Reproducible local boot (without weights)

Use Python 3.11 or 3.12. The tested local interpreters are 3.11.15 and 3.12.7.

```bash
cd lofigen-server
uv sync --frozen --python 3.12

mkdir -p "$HOME/lofigen/staging" "$HOME/lofigen/run" "$HOME/lofigen/logs"
umask 077
openssl rand -hex 32 > "$HOME/lofigen/.hmac"
chmod 600 "$HOME/lofigen/.hmac"

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
`.`/`..`, backslashes, NULs, percent-encoded punctuation, and roots or descendants that resolve
through a symlink outside staging. Future artifact I/O must use this resolver; accepting a path
from an upstream response is prohibited.

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
PYTHONPATH=src python3.11 -m unittest discover -s tests -v
```

RED/green receipts are recorded in [`docs/TDD-EVIDENCE.md`](docs/TDD-EVIDENCE.md).
