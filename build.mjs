import { loadPyodide } from "pyodide";
import fs from "fs/promises";
import path from "path";

async function build() {
  console.log("--- Stage 2: Starting Build Process ---");

  // Ensure the output directory exists and is clean
  const distPath = path.resolve("./dist");
  await fs.rm(distPath, { recursive: true, force: true });
  await fs.mkdir(distPath, { recursive: true });

  console.log("Initializing a temporary Pyodide instance...");
  const pyodide = await loadPyodide();

  console.log("Loading micropip to fetch dependencies...");
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");

  // Install dependencies from requirements.txt
  const requirements = await fs.readFile("./agent/requirements.txt", "utf8");
  console.log("Installing dependencies...");
  await micropip.install(requirements.split('\n').filter(Boolean));

  // This is where a real build process would package the installed wheels.
  // For simplicity in this demo, we will reinstall them at runtime,
  // but we'll copy our agent's source code to the 'dist' folder.
  console.log("Copying agent source code to dist/agent...");
  await fs.mkdir(path.join(distPath, "agent"));
  await fs.copyFile(
    "./agent/main.py",
    path.join(distPath, "agent/main.py")
  );
  await fs.copyFile(
    "./agent/requirements.txt",
    path.join(distPath, "agent/requirements.txt")
  );

  console.log("--- Build Complete ---");
  console.log("Production artifact is ready in the 'dist' directory.");
}

build();