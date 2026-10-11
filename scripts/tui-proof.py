"""Exercise the real CLI in an isolated Unix PTY, without desktop input."""
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

root = Path(__file__).resolve().parents[1]
scratch = Path(os.environ.get("COREDAMN_SCRATCH_DIR", Path.home() / ".cache/coredamn/development"))
scratch.mkdir(parents=True, exist_ok=True)
fixture = Path(tempfile.mkdtemp(prefix="tui-proof-", dir=scratch))
source = fixture / "synthetic.jsonl"
records = []
for i in range(12):
    records.extend([
        {"type": "user", "uuid": str(i), "sessionId": f"fixture-{i}",
         "timestamp": f"2026-09-{i+1:02}T12:00:00Z",
         "message": {"role": "user", "content": "shit fix this"}},
        {"type": "assistant", "message": {
            "role": "assistant", "content": [], "model": "fixture-model"}},
    ])
source.write_text("\n".join(json.dumps(r) for r in records))
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
process = subprocess.Popen(
    ["node", str(root / "bin/coredamn.mjs"), "tui", "--path", f"claude={source}"],
    cwd=root, stdin=slave, stdout=slave, stderr=slave,
    env={**os.environ, "TERM": "xterm-256color", "FORCE_COLOR": "1"},
)
os.close(slave)
all_output = bytearray()
ansi = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")

def expect(needle, keys=b""):
    if keys:
        os.write(master, keys)
    current = bytearray()
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.2)[0]:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            current.extend(data)
            all_output.extend(data)
            plain = ansi.sub("", current.decode("utf8", errors="replace"))
            if needle in plain:
                return
        if process.poll() is not None:
            break
    raise AssertionError(f"TUI did not render {needle!r}")

try:
    expect("Agent / Occurrences / descending")
    expect("Model / Occurrences", b"g")
    expect("Model / Per 1,000 words", b"m")
    expect("ascending", b"s")
    expect("Type to filter", b"/")
    expect("No groups match", b"missing")
    expect("g/Tab group", b"\r")
    expect("fixture-model", b"r")
    expect("Session / Per 1,000 words", b"g")
    expect("2–9 of 12 groups", b"\x1b[B")
    expect("UTC day / Per 1,000 words", b"g")
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 50, 0, 0))
    os.kill(process.pid, signal.SIGWINCH)
    expect("UTC day")
    os.write(master, b"q")
    assert process.wait(timeout=10) == 0
    print("TUI proof passed: groups, metric, sort, filter, reset, scroll, resize, quit.")
    print(fixture)
finally:
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    os.close(master)
    (fixture / "terminal.txt").write_text(ansi.sub("", all_output.decode("utf8", errors="replace")))
