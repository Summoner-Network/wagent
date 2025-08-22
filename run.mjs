import { loadPyodide } from "pyodide";
import path from "path";
import fs from "fs/promises";

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

async function run() {
  console.log("\n--- Stage 3: Starting Robust Production Runtime ---");

  const distPath = path.resolve("./dist");
  const vfsAppPath = "/app";

  console.log("Loading Pyodide runtime...");
  const pyodide = await loadPyodide();

  // Recursively write the entire project from 'dist' to the virtual FS
  console.log(`Writing project files from '${path.basename(distPath)}' to VFS at '${vfsAppPath}'...`);
  await writeProjectToVFS(pyodide, distPath, vfsAppPath);
  console.log("Project files loaded into WASM.");

  // Install dependencies if requirements.txt exists
  const requirementsPath = path.join(vfsAppPath, "requirements.txt");
  if (pyodide.FS.analyzePath(requirementsPath).exists) {
    console.log("Installing dependencies from requirements.txt...");
    await pyodide.loadPackage("micropip");
    const micropip = pyodide.pyimport("micropip");
    const requirements = pyodide.FS.readFile(requirementsPath, { encoding: "utf8" });
    await micropip.install(requirements.split("\n").filter(Boolean));
  }

  // Add the project root to the Python path
  pyodide.runPython(`
    import sys
    sys.path.append('${vfsAppPath}')
  `);

  console.log("Loading agent module 'main'...");
  const mainModule = pyodide.pyimport("main");

  // Create an instance of the agent
  const agentConfig = { vector: [5, 10, 15] };
  const agentInstance = mainModule.main(pyodide.toPy(agentConfig));

  // Interact with the agent
  console.log("--- Running Agent Task ---");
  const inputData = { vector: [2, 4, 6] };
  const result = agentInstance.run(pyodide.toPy(inputData));

  console.log("--- Task Complete ---");
  console.log("Result from agent:", result.toJs());
}

run();