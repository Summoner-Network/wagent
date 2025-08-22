# package.py
# Translates guest.run (written in normal Python) into a tiny WebAssembly module
# implementing:
#   (import "env" "log" (func $log (param i32 i32)))
#   (import "env" "sleep_ms" (func $sleep (param i32)))
#   (memory (export "memory") 1)
#   (export "run" (func $run (param i32 i32) (result i32)))
#
# The exported run takes (ptr, len) to the UTF-8 config string in guest memory.
# The host writes config into memory before calling run.
#
# This packager supports a very small subset of Python:
#   log("literal"), log(config), sleep_ms(<int literal>), return <int literal>
#
# Deterministic output: the emitted WAT is derived from the guest AST only.

from __future__ import annotations
from pathlib import Path
import ast
from wasmtime import wat2wasm
import guest

OUT_WASM = Path("guest.wasm")

# --- Parse guest.run into a tiny IR -------------------------------------------------

class Step:
    pass

class LogLiteral(Step):
    def __init__(self, text: str): self.text = text

class LogConfig(Step):
    pass

class SleepMs(Step):
    def __init__(self, ms: int): self.ms = ms

class ReturnI32(Step):
    def __init__(self, val: int): self.val = val

def parse_guest_run() -> tuple[list[Step], int, list[tuple[str, bytes]]]:
    src = Path("guest.py").read_text(encoding="utf-8")
    mod = ast.parse(src, filename="guest.py")
    fn = None
    for node in mod.body:
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            fn = node
            break
    if fn is None:
        raise SystemExit("guest.run not found")

    # Validate signature: run(config: str) -> int
    if not fn.args.args or fn.args.args[0].arg != "config":
        raise SystemExit("run must take exactly one parameter named 'config'")
    steps: list[Step] = []
    literals: list[tuple[str, bytes]] = []  # label -> bytes
    label_counter = 0
    returned = False

    def add_literal(text: str) -> str:
        nonlocal label_counter
        label = f"lit_{label_counter}"
        label_counter += 1
        literals.append((label, text.encode("utf-8")))
        return label

    for stmt in fn.body:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            call = stmt.value
            if isinstance(call.func, ast.Name) and call.func.id == "log" and len(call.args) == 1:
                arg = call.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                    steps.append(LogLiteral(add_literal(arg.value)))
                elif isinstance(arg, ast.Name) and arg.id == "config":
                    steps.append(LogConfig())
                else:
                    raise SystemExit("log accepts only a string literal or `config`")
            elif isinstance(call.func, ast.Name) and call.func.id == "sleep_ms" and len(call.args) == 1:
                arg = call.args[0]
                if isinstance(arg, ast.Constant) and isinstance(arg.value, int) and arg.value >= 0:
                    steps.append(SleepMs(int(arg.value)))
                else:
                    raise SystemExit("sleep_ms accepts only a non-negative integer literal")
            else:
                raise SystemExit("Only log(...), sleep_ms(...) calls are allowed in run")
        elif isinstance(stmt, ast.Return):
            if not (isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, int)):
                raise SystemExit("return must be an integer literal")
            steps.append(ReturnI32(int(stmt.value.value)))
            returned = True
        else:
            raise SystemExit("Only expression statements and a final return are allowed in run")

    if not returned:
        raise SystemExit("run must end with `return <int>`")

    return steps, (fn.lineno or 1), literals

# --- WAT emission -------------------------------------------------------------------

def emit_wat(steps: list[Step], literals: list[tuple[str, bytes]]) -> str:
    # Lay out literals in memory starting at offset 1024 to keep space
    # for the host to write the incoming config at offset 0..N.
    mem_offset = 1024
    data_segments = []
    lit_meta: dict[str, tuple[int, int]] = {}  # label -> (ptr, len)

    for label, b in literals:
        ptr = mem_offset
        ln = len(b)
        mem_offset += ln
        data_segments.append(f'  (data (i32.const {ptr}) "{_wat_bytes(b)}") ;; {label}')
        lit_meta[label] = (ptr, ln)

    # Helper: inline to call imported log with a data literal
    def log_literal_instr(label: str) -> str:
        ptr, ln = lit_meta[label]
        return f"    i32.const {ptr}\n    i32.const {ln}\n    call $log\n"

    # Build the body of $run
    body = []
    for s in steps:
        if isinstance(s, LogLiteral):
            body.append(log_literal_instr(s.text))
        elif isinstance(s, LogConfig):
            # params: (config_ptr, config_len)
            body.append("    local.get 0\n    local.get 1\n    call $log\n")
        elif isinstance(s, SleepMs):
            body.append(f"    i32.const {s.ms}\n    call $sleep\n")
        elif isinstance(s, ReturnI32):
            body.append(f"    i32.const {s.val}\n    return\n")
        else:
            raise AssertionError("unknown step")

    run_body = "".join(body)

    wat = f"""
(module
  (import "env" "log" (func $log (param i32 i32)))
  (import "env" "sleep_ms" (func $sleep (param i32)))
  (memory (export "memory") 1)

{chr(10).join(data_segments)}

  ;; run(config_ptr: i32, config_len: i32) -> i32
  (func $run (param i32 i32) (result i32)
{run_body}  )

  (export "run" (func $run))
)
    """.strip()
    return wat

def _wat_bytes(b: bytes) -> str:
    # Encode arbitrary bytes into WAT string with escapes
    # Printable ASCII except " and \ are emitted directly, others as \xx
    out = []
    for by in b:
        ch = chr(by)
        if 32 <= by <= 126 and ch not in {'"', '\\'}:
            out.append(ch)
        else:
            out.append(f"\\{by:02x}")
    return "".join(out)

# --- Main ---------------------------------------------------------------------------

if __name__ == "__main__":
    steps, _, literals = parse_guest_run()
    wat = emit_wat(steps, literals)
    wasm_bytes = wat2wasm(wat)
    OUT_WASM.write_bytes(wasm_bytes)
    print(f"Wrote {OUT_WASM} ({len(wasm_bytes)} bytes)")
