import { loadPyodide } from "pyodide";
import path from "path";
import fs from "fs/promises";

async function run() {
  console.log("\n--- Stage 3: Starting Production Runtime ---");

  const distPath = path.resolve("./dist/agent");
  console.log("Loading Pyodide runtime...");
  const pyodide = await loadPyodide();

  // --- FIX: Manually write files to the virtual filesystem ---
  console.log("Writing project files to virtual filesystem...");
  // Create the directory structure inside WASM
  pyodide.FS.mkdirTree("/app/agent");

  // Read files from the 'dist' directory and write them to WASM
  const mainPyContent = await fs.readFile(path.join(distPath, "main.py"));
  pyodide.FS.writeFile("/app/agent/main.py", mainPyContent);

  const requirementsContent = await fs.readFile(path.join(distPath, "requirements.txt"));
  pyodide.FS.writeFile("/app/agent/requirements.txt", requirementsContent);
  console.log("Project files loaded into WASM.");
  
  // Install dependencies from the packaged requirements.txt
  console.log("Installing dependencies from /app/agent/requirements.txt...");
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");

  const requirementsFromVFS = pyodide.FS.readFile("/app/agent/requirements.txt", { encoding: "utf8" });
  const requirementsList = requirementsFromVFS.split("\n").filter(Boolean);
  if (requirementsList.length > 0) {
    await micropip.install(requirementsList);
  }

  // Add the agent's code to the Python path
  pyodide.runPython(`
    import sys
    sys.path.append('/app/agent')
  `);

  console.log("Loading agent module...");
  const mainModule = pyodide.pyimport("main");

  // Create an instance of the agent
  const agentConfig = { vector: [5, 10, 15] };
  const agentInstance = mainModule.main(pyodide.toPy(agentConfig));

  // Interact with the agent
  console.log("--- Running Agent Task ---");
  const inputData = { vector: [2, 4, 6] };
  const result = agentInstance.run(pyodide.toPy(inputData));

  console.log("--- Task Complete ---");
  console.log("Result from agent:", result.toJs()); // Convert Pyodide object back to JS
}

run();
