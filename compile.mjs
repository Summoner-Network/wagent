import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Stage 1: Compile
 * Prepares the Pyodide WASM runtime by copying its distribution files
 * from node_modules into the 'dist' directory.
 */
async function compile() {
  console.log("--- Stage 1: Starting Compile Process ---");

  const distPath = path.resolve("./dist");
  const pyodideWasmPath = path.join(distPath, "pyodide-wasm");

  await fs.rm(distPath, { recursive: true, force: true });
  await fs.mkdir(pyodideWasmPath, { recursive: true });

  try {
    // Find the path to the installed pyodide package
    const pyodidePackagePath = path.dirname(require.resolve("pyodide/package.json"));
    console.log(`Pyodide package found at: ${pyodidePackagePath}`);

    // Check what directories exist in the pyodide package
    const pyodideContents = await fs.readdir(pyodidePackagePath);
    console.log(`Pyodide package contents: ${pyodideContents.join(', ')}`);

    // Try different possible locations for Pyodide files
    const possiblePaths = [
      path.join(pyodidePackagePath, "dist"),
      path.join(pyodidePackagePath, "pyodide"), 
      pyodidePackagePath // Sometimes files are in the root
    ];

    let pyodideDistPath = null;
    let foundFiles = [];

    for (const possiblePath of possiblePaths) {
      try {
        const stats = await fs.stat(possiblePath);
        if (stats.isDirectory()) {
          const contents = await fs.readdir(possiblePath);
          console.log(`Contents of ${possiblePath}: ${contents.join(', ')}`);
          
          // Look for key Pyodide files
          const hasWasm = contents.some(file => file.includes('.wasm'));
          const hasJs = contents.some(file => file.includes('pyodide.js') || file.includes('pyodide.mjs'));
          
          if (hasWasm && hasJs) {
            pyodideDistPath = possiblePath;
            foundFiles = contents;
            console.log(`✓ Found Pyodide files in: ${possiblePath}`);
            break;
          }
        }
      } catch (error) {
        // Path doesn't exist, continue
        continue;
      }
    }

    if (!pyodideDistPath) {
      throw new Error("Could not locate Pyodide distribution files. The package structure may have changed.");
    }

    console.log(`Copying Pyodide runtime from ${pyodideDistPath} to ${pyodideWasmPath}...`);
    console.log(`Files to copy: ${foundFiles.join(', ')}`);

    await fs.cp(pyodideDistPath, pyodideWasmPath, { recursive: true });

    // Verify the copy was successful
    const copiedFiles = await fs.readdir(pyodideWasmPath);
    console.log(`✓ Successfully copied ${copiedFiles.length} files/directories`);
    
    // Check for essential files
    const hasEssentials = copiedFiles.some(file => file.includes('.wasm')) && 
                         copiedFiles.some(file => file.includes('pyodide.js') || file.includes('pyodide.mjs'));
    
    if (!hasEssentials) {
      console.warn("⚠️  Warning: Essential Pyodide files (.wasm and .js/.mjs) may be missing");
    }

  } catch (error) {
    console.error("Failed to copy Pyodide files:", error.message);
    
    // Provide helpful debugging information
    console.log("\n--- Debugging Information ---");
    console.log("To resolve this issue, try the following:");
    console.log("1. Ensure Pyodide is installed: npm install pyodide");
    console.log("2. Check if you need a different version: npm install pyodide@latest");
    console.log("3. Clear node_modules and reinstall: rm -rf node_modules && npm install");
    console.log("4. Check the actual structure of your installed Pyodide package");
    
    process.exit(1);
  }

  console.log("--- Compile Complete ---");
  console.log(`Pyodide WASM runtime is ready in '${path.basename(pyodideWasmPath)}'.`);
}

compile();