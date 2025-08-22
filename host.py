from pathlib import Path
import time
from wasmtime import Engine, Store, Module, Instance, Func, FuncType, ValType, Memory, WasmtimeError
from typing import Any

# --- High-level Abstractions ---

class WasmGuest:
    """
    Represents a running Wasm guest instance. It handles loading,
    instantiation, and provides a high-level API for interacting
    with the Wasm module's memory and exported functions.
    """
    def __init__(self, wasm_file: Path):
        if not wasm_file.exists():
            raise FileNotFoundError(f"Wasm file not found at: {wasm_file}")

        self.engine = Engine()
        self.store = Store(self.engine)
        
        print(f"Loading Wasm module from {wasm_file}...")
        self.module = Module(self.engine, wasm_file.read_bytes())
        
        self._analyze_imports()

        # Host-provided functions will be defined here
        self.host = Host(self.store)
        
        imports = self._prepare_imports()
        
        print("Instantiating module...")
        self.instance = Instance(self.store, self.module, imports)
        
        # Link the instance's memory to the host
        memory = self.instance.exports(self.store)["memory"]
        if not isinstance(memory, Memory):
            raise TypeError("Wasm module did not export 'memory'")
        self.host.memory = memory
        
        print("Successfully instantiated WASM module.")

    def _analyze_imports(self):
        """Prints the imports required by the Wasm module."""
        print("Analyzing WASM module imports...")
        for imp in self.module.imports:
            print(f"  - Import: {imp.module}.{imp.name}")

    def _prepare_imports(self) -> list[Func]:
        """Creates the Func objects for the host functions."""
        log_import = Func(self.store, FuncType([ValType.i32(), ValType.i32()], []), self.host.log_fn_impl)
        sleep_import = Func(self.store, FuncType([ValType.i32()], []), self.host.sleep_fn_impl)
        return [log_import, sleep_import]

    def call(self, func_name: str, *args: Any) -> Any:
        """
        Calls an exported function from the Wasm module.
        
        Args:
            func_name: The name of the exported function to call.
            *args: The arguments to pass to the function.
            
        Returns:
            The result of the function call.
        """
        exports = self.instance.exports(self.store)
        func = exports[func_name]
        if not isinstance(func, Func):
            raise TypeError(f"Export '{func_name}' is not a function.")
        
        print(f"Calling exported function '{func_name}' with args: {args}")
        return func(self.store, *args)

    def write_memory(self, offset: int, data: bytes):
        """Writes data to the Wasm instance's memory."""
        print(f"Writing {len(data)} bytes to memory at offset {offset}")
        self.host.memory.write(self.store, data, offset)


class Host:
    """
    Manages the state and implementations of functions provided by the
    host to the Wasm guest.
    """
    def __init__(self, store: Store):
        self.store = store
        self.memory: Memory | None = None

    def log_fn_impl(self, ptr: int, length: int):
        """Implementation of the 'log' function for the Wasm guest."""
        if self.memory is None:
            print("Host Error: Memory not available for logging.")
            return
        try:
            data = self.memory.read(self.store, ptr, length)
            message = data.decode('utf-8', errors='replace')
            print(f"WASM log: {message}")
        except Exception as e:
            print(f"Error in host log_fn: {e}")

    def sleep_fn_impl(self, ms: int):
        """Implementation of the 'sleep_ms' function for the Wasm guest."""
        try:
            print(f"WASM request: sleep for {ms}ms")
            time.sleep(ms / 1000.0)
        except Exception as e:
            print(f"Error in host sleep_fn: {e}")


# --- Main script execution ---
if __name__ == "__main__":
    try:
        # 1. Create a Wasm guest instance from the .wasm file.
        #    This handles all the setup and instantiation.
        guest = WasmGuest(Path("guest.wasm"))

        # 2. Prepare the configuration to be passed to the guest.
        config = b"demo-config"
        CONFIG_PTR = 0
        
        # 3. Use the high-level API to write to the guest's memory.
        guest.write_memory(CONFIG_PTR, config)
        
        # 4. Use the high-level API to call the 'run' function.
        result = guest.call("run", CONFIG_PTR, len(config))
        
        print(f"\n'run' function returned: {result}")
        
    except (WasmtimeError, RuntimeError, TypeError, FileNotFoundError) as e:
        print(f"\nAn error occurred: {e}")
        import traceback
        traceback.print_exc()
