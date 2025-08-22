# AI Agent Demo with Pyodide and WebAssembly

This project is a complete, end-to-end demonstration of a modern workflow for developing and deploying Python-based AI agents using WebAssembly. It shows how to package a Python script with its dependencies into a portable artifact that can be securely executed in a Node.js environment.

The demo is split into three distinct scripts that represent the stages of a real-world development lifecycle:

1.  **`agent/`**: The agent's Python source code.
2.  **`build.mjs`**: The packaging script that creates a production-ready artifact.
3.  **`run.mjs`**: The production runtime that loads and executes the agent.

### One-Time Setup

Before running the demo, you need to set up the project environment. This only needs to be done once.

1.  **Install Node.js:** Ensure you have Node.js (version 18 or higher) installed on your system.
2.  **Clone the Repository:** If you haven't already, clone this project to your local machine.
3.  **Install Dependencies:** Open your terminal in the project's root directory and run the following command to download the `pyodide` package:
    ```bash
    npm install
    ```

### How to Run the Demo

Follow these two steps to build the agent and run it in the simulated production environment.

#### Step 1: Build the Agent

The build script simulates a CI/CD pipeline. It takes the Python source code from the `agent/` directory and prepares it for production by placing it in a `dist/` folder.

```bash
node build.mjs
```

#### Step 2: Run the Agent

The run script simulates a production server. It loads the agent from the `dist/` folder, installs its dependencies in a secure WASM sandbox, and executes its main task.

```bash
node run.mjs
```

You will see the agent initialize, perform its calculation, and return the result to the Node.js host.

### How It Works: The Production Runtime (`run.mjs`)

The `run.mjs` script is the core of the deployment strategy. It demonstrates how a host environment can securely run a packaged Python application without a local Python installation.

1.  **Load Pyodide:** It begins by initializing the Pyodide WebAssembly runtime, which includes the CPython interpreter.
2.  **Create Virtual Filesystem:** The script manually reads the agent's `main.py` and `requirements.txt` from the local `dist/` folder. It then writes these files into an in-memory virtual filesystem inside the WASM environment at the `/app/agent/` path.
3.  **Install Dependencies:** It starts `micropip` (Pyodide's package installer), reads the `requirements.txt` from the virtual filesystem, and installs the necessary Python packages (like `numpy`) into the sandboxed environment.
4.  **Execute Agent:** Once the environment is ready, the script adds the `/app/agent` directory to Python's `sys.path`. This allows it to import the `main` module and call its `main()` function, creating an instance of the `SimpleAgent` class.
5.  **Interact and Get Results:** Finally, the script passes input data to the agent's `run` method. It receives the result back from the Python code and uses the `.toJs()` method to convert it from a Pyodide object back into a native JavaScript object for further use in the host application.