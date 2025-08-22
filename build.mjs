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

async function build() {
  console.log("--- Stage 2: Starting Robust Build Process ---");

  const sourcePath = path.resolve("./agent");
  const distPath = path.resolve("./dist");

  // Clean and recreate the dist directory
  await fs.rm(distPath, { recursive: true, force: true });
  await fs.mkdir(distPath, { recursive: true });

  // Recursively copy the entire agent project
  console.log(`Copying agent source from ${sourcePath} to ${distPath}...`);
  await copyDir(sourcePath, distPath);

  console.log("--- Build Complete ---");
  console.log(`Production artifact is ready in the '${path.basename(distPath)}' directory.`);
}

build();