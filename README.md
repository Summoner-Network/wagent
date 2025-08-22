# AI Agent Production Runtime

This script simulates a production environment that loads and executes a pre-packaged AI agent. It uses Pyodide to run the Python agent in a secure WebAssembly sandbox, demonstrating the final stage of the deployment workflow.

### How It Works

The script follows a clear, step-by-step process to bring the AI agent to life within the Node.js environment.

1.  **Load Pyodide:** It begins by initializing the Pyodide WebAssembly runtime, which includes the CPython interpreter.

2.  **Create Virtual Filesystem:** Since the Node.js version of Pyodide cannot directly mount local directories, the script manually reads the agent's `main.py` and `requirements.txt` from the local `dist/` folder. It then writes these files into an in-memory virtual filesystem inside the WASM environment at the `/app/agent/` path.

3.  **Install Dependencies:** The script starts `micropip` (Pyodide's package installer), reads the `requirements.txt` from the virtual filesystem, and installs the necessary Python packages (like `numpy`) into the sandboxed environment.

4.  **Execute Agent:** Once the environment is ready, the script adds the `/app/agent` directory to Python's `sys.path`. This allows it to import the `main` module and call its `main()` function, creating an instance of the `SimpleAgent` class.

5.  **Interact and Get Results:** Finally, the script passes input data to the agent's `run` method. It receives the result back from the Python code and uses the `.toJs()` method to convert it from a Pyodide object back into a native JavaScript object for further use in the host application.

### Prerequisites

Before running this script, you must first execute the build script to create the production artifact in the `dist/` directory.

```
node build.mjs
```

### Usage

To run the production simulation and execute the agent, use the following command:

```
node run.mjs
```