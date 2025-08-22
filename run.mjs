import { loadPyodide } from "pyodide";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";

// Helper to recursively write a local directory to the virtual FS
async function writeProjectToVFS(pyodide, localPath, vfsPath) {
  await pyodide.FS.mkdirTree(vfsPath);
  const entries = await fs.readdir(localPath, { withFileTypes: true });
  for (let entry of entries) {
    const localEntryPath = path.join(localPath, entry.name);
    const vfsEntryPath = path.join(vfsPath, entry.name);
    if (entry.isDirectory()) {
      await writeProjectToVFS(pyodide, localEntryPath, vfsEntryPath);
    } else {
      const content = await fs.readFile(localEntryPath);
      pyodide.FS.writeFile(vfsEntryPath, content);
    }
  }
}

/**
 * Executes a single agent task within the Pyodide environment.
 */
async function executeAgentTask(pyodide, agentName, inputData) {
  console.log(`\n--- Executing Agent: ${agentName} ---`);
  
  const vfsTapesPath = "/tapes";
  const inputTapePath = path.join(vfsTapesPath, "in.json");
  const outputTapePath = path.join(vfsTapesPath, "out.json");

  // Map agent name to proper module name
  const moduleMapping = {
    'main': 'agent.main',
    'multiplier': 'multiplier.main'
  };
  
  const agentModulePath = moduleMapping[agentName] || `${agentName}.main`;
  console.log(`Loading agent module '${agentModulePath}'...`);
  const agentModule = pyodide.pyimport(agentModulePath);

  const agentConfig = agentName === 'main' ? { vector: [5, 10, 15] } : {};
  const agentInstance = agentModule.main(pyodide.toPy(agentConfig));

  const traceId = crypto.randomUUID();
  console.log(`Generated Trace ID: ${traceId}`);

  const tapeInput = {
    trace_id: traceId,
    payload: inputData,
  };
  console.log(`Feeding input tape at '${inputTapePath}'...`);
  pyodide.FS.writeFile(inputTapePath, JSON.stringify(tapeInput));
  
  agentInstance.run(inputTapePath, outputTapePath);

  console.log(`Reading output tape from '${outputTapePath}'...`);
  const resultRaw = pyodide.FS.readFile(outputTapePath, { encoding: "utf8" });
  const resultData = JSON.parse(resultRaw);

  console.log("Verifying trace ID...");
  if (resultData.trace_id === traceId) {
    console.log("✅ Trace ID successfully verified.");
  } else {
    console.error(`❌ Trace ID mismatch! Expected ${traceId}, got ${resultData.trace_id}`);
    throw new Error("Trace ID mismatch");
  }
  
  return resultData;
}


async function main() {
  console.log("\n--- Stage 4: Starting Orchestration Runtime ---");

  const distPath = path.resolve("./dist");
  const pyodideWasmPath = path.join(distPath, "pyodide-wasm");
  const appSourcePath = path.join(distPath, "app");
  const vfsAppPath = "/app";

  const pyodide = await loadPyodide({
    indexURL: pyodideWasmPath,
    stdout: (text) => console.log(`[Python STDOUT] ${text}`),
    stderr: (text) => console.error(`[Python STDERR] ${text}`),
  });

  await writeProjectToVFS(pyodide, appSourcePath, vfsAppPath);
  console.log("Project files loaded into WASM.");

  const vfsVendorPath = path.join(vfsAppPath, 'vendor');
  if (pyodide.FS.analyzePath(vfsVendorPath).exists) {
    console.log("Installing dependencies from local vendor directory...");
    
    // Load micropip first
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    
    // Get all wheel files
    const wheelFiles = pyodide.FS.readdir(vfsVendorPath)
      .filter(file => file.endsWith('.whl'));
    
    console.log(`Found ${wheelFiles.length} wheel files to install:`, wheelFiles);
    
    if (wheelFiles.length > 0) {
      // Create a temporary directory in /tmp for micropip
      pyodide.runPython(`
import os
os.makedirs('/tmp/wheels', exist_ok=True)
      `);
      
      // Copy wheels to /tmp and install from there
      for (const wheelFile of wheelFiles) {
        const sourcePath = path.join(vfsVendorPath, wheelFile);
        const destPath = `/tmp/wheels/${wheelFile}`;
        
        console.log(`Installing ${wheelFile}...`);
        try {
          // Copy the wheel to /tmp
          const wheelData = pyodide.FS.readFile(sourcePath);
          pyodide.FS.writeFile(destPath, wheelData);
          
          // Install using micropip with emfs:// protocol
          await micropip.install(`emfs:${destPath}`);
          console.log(`  ✅ Successfully installed ${wheelFile}`);
        } catch (error) {
          console.error(`  ❌ Failed to install ${wheelFile}:`, error.message);
          
          // Try installing with just the file path
          try {
            console.log(`  Trying direct path installation for ${wheelFile}...`);
            await micropip.install(destPath);
            console.log(`  ✅ Successfully installed ${wheelFile} via direct path`);
          } catch (altError) {
            console.error(`  ❌ Direct path installation also failed:`, altError.message);
            // Don't throw here, continue with other packages
            console.log(`  ⚠️ Skipping ${wheelFile}, continuing with other packages...`);
          }
        }
      }
      console.log("✅ Vendored packages installation process completed");
    } else {
      console.log("⚠️ No wheel files found in vendor directory");
    }
  } else {
    console.log("⚠️ Vendor directory not found, skipping package installation");
  }

  // Dynamically find all agent directories within the VFS and add them to the Python path
  const agentDirsInVfs = pyodide.FS.readdir(vfsAppPath)
    .filter(name => {
      try {
        return pyodide.FS.isDir(pyodide.FS.stat(`${vfsAppPath}/${name}`).mode) && name !== 'vendor';
      } catch (e) {
        return false;
      }
    });
  
  console.log("Dynamically adding agent directories to Python path:", agentDirsInVfs);
  
  // Fix the indentation issue by properly formatting the Python code
  const pythonCode = `
import sys
${agentDirsInVfs.map(dir => `sys.path.append('${vfsAppPath}/${dir}')`).join('\n')}
print("Python path updated successfully")
print("Available paths:", sys.path[-${agentDirsInVfs.length}:])
  `.trim();

  console.log("Executing Python path setup...");
  pyodide.runPython(pythonCode);
  
  pyodide.FS.mkdir("/tapes");

  // Check if numpy is available
  try {
    pyodide.runPython("import numpy; print('✅ NumPy is available:', numpy.__version__)");
  } catch (error) {
    console.error("❌ NumPy not available:", error.message);
    console.log("This indicates the vendoring process may not have worked correctly.");
    throw error;
  }

  // --- Orchestration Loop ---
  let nextTask = {
    agentName: "main",
    inputData: { vector: [2, 4, 6] } // The initial input for the first agent
  };
  let finalResult = null;

  while (nextTask) {
    const result = await executeAgentTask(pyodide, nextTask.agentName, nextTask.inputData);

    if (result.status === "complete") {
      console.log("\n--- Workflow Complete ---");
      finalResult = result.result;
      nextTask = null; // Exit the loop
    } else if (result.status === "pending" && result.action?.type === "run_agent") {
      const actionPayload = result.action.payload;
      console.log(`\n--- Workflow Pending: Received request to run '${actionPayload.agent_name}' ---`);
      nextTask = {
        agentName: actionPayload.agent_name,
        inputData: actionPayload.input_data
      };
    } else {
      console.error("Invalid response from agent:", result);
      nextTask = null;
    }
  }

  console.log("\nFinal result from agent workflow:", finalResult);
}

main().catch(error => {
  console.error("Runtime failed:", error);
  process.exit(1);
});