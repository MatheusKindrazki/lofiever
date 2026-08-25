import argparse
import contextlib
import io
import json
import os
import re
import signal
import stat
import struct
import subprocess
import sys
import threading
import time
import wave

OUTPUT_ROOT_FD = 4
WORKING_DIRECTORY_FD = 5
SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

# The inherited output-root capability is probed before behavior, model, or
# output state. The initialize response later correlates this kernel identity.
try:
    _output_root_stats = os.fstat(OUTPUT_ROOT_FD)
    _working_directory_stats = os.fstat(WORKING_DIRECTORY_FD)
    if not stat.S_ISDIR(_output_root_stats.st_mode):
        raise OSError("output root descriptor is not a directory")
    if not stat.S_ISDIR(_working_directory_stats.st_mode):
        raise OSError("working directory descriptor is not a directory")
    os.fchdir(WORKING_DIRECTORY_FD)
    _working_cwd_stats = os.stat(".", follow_symlinks=False)
    if (
        _working_cwd_stats.st_dev != _working_directory_stats.st_dev
        or _working_cwd_stats.st_ino != _working_directory_stats.st_ino
    ):
        raise OSError("working directory capability mismatch")
except OSError:
    os._exit(9)

OUTPUT_ROOT_IDENTITY = {
    "fileDescriptor": OUTPUT_ROOT_FD,
    "device": str(_output_root_stats.st_dev),
    "inode": str(_output_root_stats.st_ino),
    "uid": _output_root_stats.st_uid,
    "mode": stat.S_IMODE(_output_root_stats.st_mode),
}
WORKING_DIRECTORY_IDENTITY = {
    "fileDescriptor": WORKING_DIRECTORY_FD,
    "device": str(_working_directory_stats.st_dev),
    "inode": str(_working_directory_stats.st_ino),
    "uid": _working_directory_stats.st_uid,
    "mode": stat.S_IMODE(_working_directory_stats.st_mode),
}


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def split_relative(relative_path):
    if (
        not isinstance(relative_path, str)
        or not relative_path
        or len(relative_path) > 4096
        or relative_path.startswith("/")
        or "\\" in relative_path
        or "\x00" in relative_path
    ):
        raise ValueError("unsafe relative output path")
    components = relative_path.split("/")
    if any(
        component in {".", ".."} or SAFE_COMPONENT.fullmatch(component) is None
        for component in components
    ):
        raise ValueError("unsafe relative output component")
    return components


def assert_output_root_identity():
    current = os.fstat(OUTPUT_ROOT_FD)
    observed = {
        "fileDescriptor": OUTPUT_ROOT_FD,
        "device": str(current.st_dev),
        "inode": str(current.st_ino),
        "uid": current.st_uid,
        "mode": stat.S_IMODE(current.st_mode),
    }
    if observed != OUTPUT_ROOT_IDENTITY or not stat.S_ISDIR(current.st_mode):
        raise OSError("output root capability changed")


def directory_identity(stats):
    return {
        "device": str(stats.st_dev),
        "inode": str(stats.st_ino),
        "uid": stats.st_uid,
        "mode": stat.S_IMODE(stats.st_mode),
    }


@contextlib.contextmanager
def open_relative_directory(components, create=False):
    assert_output_root_identity()
    current_fd = os.dup(OUTPUT_ROOT_FD)
    try:
        for component in components:
            if create:
                try:
                    os.mkdir(component, mode=0o700, dir_fd=current_fd)
                except FileExistsError:
                    pass
            child_fd = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=current_fd,
            )
            descriptor = os.fstat(child_fd)
            path_stats = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
            if (
                not stat.S_ISDIR(descriptor.st_mode)
                or stat.S_ISLNK(path_stats.st_mode)
                or descriptor.st_dev != path_stats.st_dev
                or descriptor.st_ino != path_stats.st_ino
            ):
                os.close(child_fd)
                raise OSError("output directory identity changed")
            os.close(current_fd)
            current_fd = child_fd
        yield current_fd
    finally:
        os.close(current_fd)


def same_file(before, after):
    return (
        before.st_dev == after.st_dev
        and before.st_ino == after.st_ino
        and before.st_size == after.st_size
        and before.st_mtime_ns == after.st_mtime_ns
        and before.st_ctime_ns == after.st_ctime_ns
    )


def read_bytes(relative_path, max_bytes=1024 * 1024):
    components = split_relative(relative_path)
    name = components.pop()
    with open_relative_directory(components) as directory_fd:
        file_fd = os.open(
            name,
            os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        try:
            before = os.fstat(file_fd)
            path_before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if (
                not stat.S_ISREG(before.st_mode)
                or stat.S_ISLNK(path_before.st_mode)
                or not same_file(before, path_before)
                or before.st_size > max_bytes
            ):
                raise OSError("unsafe or oversized output file")
            chunks = []
            remaining = before.st_size
            while remaining:
                chunk = os.read(file_fd, min(remaining, 64 * 1024))
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            payload = b"".join(chunks)
            after = os.fstat(file_fd)
            path_after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if (
                remaining != 0
                or not same_file(before, after)
                or not same_file(after, path_after)
            ):
                raise OSError("output file changed while reading")
            return payload
        finally:
            os.close(file_fd)


def read_json(relative_path):
    return json.loads(read_bytes(relative_path).decode("utf-8"))


def load_behavior():
    try:
        return read_json("fixture-behavior.json")
    except FileNotFoundError:
        return {"mode": "success"}


def output_exists(relative_path):
    try:
        read_bytes(relative_path, max_bytes=64 * 1024)
        return True
    except FileNotFoundError:
        return False


def write_bytes_atomic(relative_path, payload, expected_parent_identity=None):
    components = split_relative(relative_path)
    name = components.pop()
    with open_relative_directory(components, create=True) as directory_fd:
        if (
            expected_parent_identity is not None
            and directory_identity(os.fstat(directory_fd)) != expected_parent_identity
        ):
            raise OSError("output parent identity disagrees with preflight")
        try:
            existing = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode):
                raise OSError("unsafe output leaf")
        except FileNotFoundError:
            pass
        temporary = f"tmp-{os.getpid()}-{time.monotonic_ns()}"
        file_fd = os.open(
            temporary,
            os.O_RDWR
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=directory_fd,
        )
        published = False
        try:
            view = memoryview(payload)
            while view:
                written = os.write(file_fd, view)
                if written <= 0:
                    raise OSError("output write made no progress")
                view = view[written:]
            os.fsync(file_fd)
            temporary_before = os.fstat(file_fd)
            temporary_path_before = os.stat(
                temporary,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if (
                not stat.S_ISREG(temporary_before.st_mode)
                or stat.S_ISLNK(temporary_path_before.st_mode)
                or not same_file(temporary_before, temporary_path_before)
                or temporary_before.st_size != len(payload)
            ):
                raise OSError("temporary output identity changed")
            persisted = b""
            while len(persisted) < len(payload):
                chunk = os.pread(
                    file_fd,
                    len(payload) - len(persisted),
                    len(persisted),
                )
                if not chunk:
                    break
                persisted += chunk
            temporary_after = os.fstat(file_fd)
            temporary_path_after = os.stat(
                temporary,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if (
                persisted != payload
                or not same_file(temporary_before, temporary_after)
                or not same_file(temporary_after, temporary_path_after)
            ):
                raise OSError("output bytes changed before publish")
            os.replace(
                temporary,
                name,
                src_dir_fd=directory_fd,
                dst_dir_fd=directory_fd,
            )
            published = True
            os.fsync(directory_fd)
            published_before = os.fstat(file_fd)
            published_path_before = os.stat(
                name,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if (
                stat.S_ISLNK(published_path_before.st_mode)
                or not same_file(published_before, published_path_before)
            ):
                raise OSError("published output identity changed")
            published_bytes = b""
            while len(published_bytes) < len(payload):
                chunk = os.pread(
                    file_fd,
                    len(payload) - len(published_bytes),
                    len(published_bytes),
                )
                if not chunk:
                    break
                published_bytes += chunk
            published_after = os.fstat(file_fd)
            published_path_after = os.stat(
                name,
                dir_fd=directory_fd,
                follow_symlinks=False,
            )
            if (
                published_bytes != payload
                or not same_file(published_before, published_after)
                or not same_file(published_after, published_path_after)
            ):
                raise OSError("published output bytes changed")
        finally:
            os.close(file_fd)
            if not published:
                try:
                    os.unlink(temporary, dir_fd=directory_fd)
                except FileNotFoundError:
                    pass


def write_json_atomic(relative_path, payload, expected_parent_identity=None):
    write_bytes_atomic(
        relative_path,
        (json.dumps(payload, indent=2) + "\n").encode("utf-8"),
        expected_parent_identity,
    )


def arm_parent_liveness(parent_liveness):
    harness_pid = parent_liveness.get("harnessPid")
    file_descriptor = parent_liveness.get("fileDescriptor")
    if (
        not isinstance(harness_pid, int)
        or harness_pid < 1
        or file_descriptor != 3
        or os.getppid() != harness_pid
    ):
        raise SystemExit(4)

    armed = threading.Event()

    def watch_parent():
        armed.set()
        try:
            while os.read(file_descriptor, 1):
                pass
        except OSError:
            pass
        os._exit(97)

    threading.Thread(
        target=watch_parent,
        name="lofiever-parent-liveness",
        daemon=True,
    ).start()
    if not armed.wait(timeout=1):
        raise SystemExit(5)
    return {
        "harnessPid": harness_pid,
        "fileDescriptor": file_descriptor,
        "armed": True,
    }


parser = argparse.ArgumentParser()
parser.add_argument("--protocol", required=True)
args = parser.parse_args()
if args.protocol != "lofiever-benchmark-jsonl-v1":
    raise SystemExit(2)

initialized = False
awaiting_boundary = None
shutdown_after_boundary = False
trailing_after_boundary = None
for line in sys.stdin:
    request = json.loads(line)
    if request["type"] == "confirm-response-boundary":
        if (
            awaiting_boundary is None
            or request.get("protocolVersion") != "1.0.0"
            or request.get("protocolRequestId") != awaiting_boundary
        ):
            raise SystemExit(6)
        boundary = {
            "type": "response-boundary",
            "protocolVersion": "1.0.0",
            "protocolRequestId": awaiting_boundary,
        }
        if trailing_after_boundary == "trailing_partial_immediate":
            sys.stdout.write(
                json.dumps(boundary, separators=(",", ":")) + "\n" + "x"
            )
            sys.stdout.flush()
        else:
            emit(boundary)
        awaiting_boundary = None
        trailing = trailing_after_boundary
        trailing_after_boundary = None
        if trailing == "trailing_partial_delayed":
            time.sleep(0.05)
            os.write(sys.stdout.fileno(), b"x")
        if trailing == "exit_after_boundary":
            break
        if shutdown_after_boundary:
            break
        continue
    if awaiting_boundary is not None:
        raise SystemExit(7)
    protocol_request_id = request.get("protocolRequestId")
    if not isinstance(protocol_request_id, int) or protocol_request_id < 1:
        raise SystemExit(8)
    if request["type"] == "initialize":
        parent_liveness = arm_parent_liveness(request.get("parentLiveness", {}))
        if request.get("outputRoot") != OUTPUT_ROOT_IDENTITY:
            raise SystemExit(10)
        if request.get("workingDirectory") != WORKING_DIRECTORY_IDENTITY:
            raise SystemExit(11)
        behavior = load_behavior()
        identity = request["expectedIdentity"]
        if behavior.get("mode") == "identity_mismatch":
            identity = json.loads(json.dumps(identity))
            identity["model"]["lm"]["revision"] = "wrong-revision"
        if behavior.get("mode") == "host_identity_mismatch":
            identity = json.loads(json.dumps(identity))
            identity["host"]["chip"] = "forged-host-label"
        lifecycle_path = "adapter-lifecycle.json"
        lifecycle = {
            "initializations": 1,
            "pid": os.getpid(),
            "harnessPid": parent_liveness["harnessPid"],
            "pythonSafePath": sys.flags.safe_path,
            "pythonClosureSha256": (identity["adapter"].get("dynamicLinker") or {}).get(
                "closureSha256"
            ),
            "ffprobeClosureSha256": (
                identity["toolchain"]["ffprobe"].get("dynamicLinker") or {}
            ).get("closureSha256"),
            "executions": 0,
        }
        write_json_atomic(lifecycle_path, lifecycle)
        initialized = True
        emit(
            {
                "type": "initialized",
                "protocolVersion": "1.0.0",
                "sessionId": f"fixture-{os.getpid()}",
                "identity": identity,
                "parentLiveness": parent_liveness,
                "outputRoot": OUTPUT_ROOT_IDENTITY,
                "workingDirectory": WORKING_DIRECTORY_IDENTITY,
                "protocolRequestId": protocol_request_id,
            }
        )
        awaiting_boundary = protocol_request_id
        continue
    if request["type"] == "shutdown":
        behavior = load_behavior()
        shutdown_response = {
            "type": (
                "completed"
                if behavior.get("mode") == "wrong_shutdown_type"
                else "shutdown-complete"
            ),
            "protocolRequestId": protocol_request_id,
        }
        if behavior.get("mode") == "wrong_shutdown_shape":
            shutdown_response["unexpected"] = True
        emit(shutdown_response)
        awaiting_boundary = protocol_request_id
        shutdown_after_boundary = True
        continue
    if request["type"] != "execute" or not initialized:
        raise SystemExit(3)

    behavior = load_behavior()
    mode = behavior.get("mode", "success")
    if mode == "exit_after_boundary_with_worker":
        worker = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(30)"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
        write_json_atomic("orphan-worker.json", {"pid": worker.pid})
    lifecycle_path = "adapter-lifecycle.json"
    lifecycle = read_json(lifecycle_path)
    lifecycle["executions"] += 1
    write_json_atomic(lifecycle_path, lifecycle)

    if mode == "wait_before_output":
        write_json_atomic("adapter-before-output.json", {"ready": True})
        deadline = time.monotonic() + 5
        while not output_exists("adapter-continue-output.json"):
            if time.monotonic() >= deadline:
                raise SystemExit(12)
            time.sleep(0.01)

    if mode == "hang" or (
        mode == "hang_at"
        and request["phase"] == behavior.get("phase")
        and request["index"] == behavior.get("index")
    ):
        time.sleep(float(behavior.get("seconds", 30)))
        continue
    if mode == "stderr_overflow":
        sys.stderr.write("x" * int(behavior.get("bytes", 100000)))
        sys.stderr.flush()
        time.sleep(30)
        continue
    if mode == "missing_sidecar":
        emit(
            {
                "type": "completed",
                "requestSha256": request["identity"]["requestSha256"],
                "protocolRequestId": protocol_request_id,
            }
        )
        awaiting_boundary = protocol_request_id
        continue

    candidates = []
    if mode != "generation_failure":
        effective_batch_size = int(
            behavior.get("effectiveBatchSize", request["batchSizeRequested"])
        )
        for index in range(1, effective_batch_size + 1):
            artifact = f'{request["artifactDirectory"]}/candidate-{index}.wav'
            audio_bytes = io.BytesIO()
            with wave.open(audio_bytes, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(8)
                audio.writeframes(
                    struct.pack("<h", index)
                    * (int(request["durationSeconds"]) * 8)
                )
            write_bytes_atomic(
                artifact,
                audio_bytes.getvalue(),
                request["artifactDirectoryIdentity"],
            )
            candidates.append(
                {
                    "index": index,
                    "durationSeconds": request["durationSeconds"],
                    "wallTimeSeconds": 0.01 * index,
                    "outputFile": artifact,
                }
            )
    error = None
    status = "success"
    if mode in {"generation_failure", "allocation_failure"}:
        status = "failure"
        allocation = mode == "allocation_failure"
        error = {
            "code": "allocation_failure" if allocation else "generation_failed",
            "category": "allocation" if allocation else "executor",
            "message": "Fixture generation failed.",
            "retryable": False,
            "allocationFailure": allocation,
            "detailsSha256": None,
        }
        candidates = []

    identity = request["identity"]
    if mode == "sidecar_identity_mismatch":
        identity = json.loads(json.dumps(identity))
        identity["runId"] = "0" * 64
    sidecar = {
        "schemaVersion": "1.0.0",
        "identity": identity,
        "status": status,
        "metrics": {
            "peakMemoryBytes": None,
            "energyWh": None,
        },
        "metricUnavailableReason": {
            "peakMemoryBytes": "fixture_not_collected",
            "energyWh": "fixture_not_collected",
        },
        "candidates": candidates,
        "error": error,
    }
    if mode == "incomplete_sidecar":
        del sidecar["identity"]
    write_json_atomic(
        request["resultPath"],
        sidecar,
        request["recordDirectoryIdentity"],
    )
    acknowledgement = {
        "type": "completed",
        "requestSha256": request["identity"]["requestSha256"],
        "protocolRequestId": protocol_request_id,
    }
    if mode == "extra_response":
        sys.stdout.write(
            json.dumps(acknowledgement, separators=(",", ":"))
            + "\n"
            + json.dumps(
                {
                    "type": "unexpected",
                    "protocolRequestId": protocol_request_id,
                },
                separators=(",", ":"),
            )
            + "\n"
        )
        sys.stdout.flush()
    elif mode == "extra_response_split":
        emit(acknowledgement)
        time.sleep(0.05)
        emit({"type": "unexpected", "protocolRequestId": protocol_request_id})
    else:
        emit(acknowledgement)
    awaiting_boundary = protocol_request_id
    if mode in {
        "trailing_partial_immediate",
        "trailing_partial_delayed",
        "exit_after_boundary",
        "exit_after_boundary_with_worker",
    }:
        trailing_after_boundary = (
            "exit_after_boundary"
            if mode == "exit_after_boundary_with_worker"
            else mode
        )
