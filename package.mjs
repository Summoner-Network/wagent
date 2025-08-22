import fs from "fs/promises";
import path from "path";

// Helper function to recursively copy a directory
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (let entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    entry.isDirectory() ? await copyDir(srcPath, destPath) : await fs.copyFile(srcPath, destPath);
  }
}

/**
 * Stage 3: Package
 * Finds all agent directories, copies their source and the shared vendored
 * dependencies into the 'dist' directory.
 */
async function packageApp() {
  console.log("--- Stage 3: Starting Package Process ---");

  const rootDir = path.resolve(".");
  const distAppPath = path.resolve("./dist/app");
  const vendorSourcePath = path.resolve("./vendor");

  // Find all directories starting with 'agent'
  const allEntries = await fs.readdir(rootDir, { withFileTypes: true });
  const agentDirs = allEntries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('agent'))
    .map(entry => entry.name);

  if (agentDirs.length === 0) {
    throw new Error("No 'agent-*' directories found.");
  }

  console.log(`Found agent directories: ${agentDirs.join(', ')}`);

  // Package each agent
  for (const agentDir of agentDirs) {
    const sourcePath = path.resolve(agentDir);
    // Sanitize agent name for use as a directory name (e.g., 'agent-multiplier' -> 'multiplier')
    const packageName = agentDir.replace('agent-', '');
    const packageDestPath = path.join(distAppPath, packageName);

    console.log(`Copying source for '${agentDir}' to '${packageDestPath}'...`);
    await copyDir(sourcePath, packageDestPath);
  }

  // Copy the shared vendored packages into the app root
  console.log(`Copying all vendored packages to ${path.join(distAppPath, 'vendor')}...`);
  await copyDir(vendorSourcePath, path.join(distAppPath, 'vendor'));

  console.log("--- Package Complete ---");
}

packageApp();
