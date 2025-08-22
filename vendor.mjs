import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Stage 2: Vendor
 * Downloads WASM-compatible wheels for ALL dependencies from Pyodide distribution,
 * creating a complete offline package cache.
 */
async function vendorDependencies() {
  console.log("--- Stage 2: Starting Vendor Process ---");
  const vendorPath = path.resolve("./vendor");

  // 1. Find and combine all requirements.txt files
  const rootDir = path.resolve(".");
  const allEntries = await fs.readdir(rootDir, { withFileTypes: true });
  const agentDirs = allEntries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('agent'))
    .map(entry => entry.name);

  let allRequirements = new Set();
  for (const agentDir of agentDirs) {
      const reqPath = path.join(agentDir, 'requirements.txt');
      try {
          const content = await fs.readFile(reqPath, 'utf-8');
          content.split("\n").filter(Boolean).forEach(req => allRequirements.add(req.trim()));
          console.log(`Found requirements in ${agentDir}`);
      } catch (e) { /* Ignore missing files */ }
  }
  const requirements = Array.from(allRequirements);
  console.log("Combined requirements:", requirements);

  // 2. Clean and create the local vendor directory on the host
  await fs.rm(vendorPath, { recursive: true, force: true });
  await fs.mkdir(vendorPath, { recursive: true });

  // 3. Load the Pyodide package metadata
  const pyodidePackagePath = path.dirname(require.resolve("pyodide/package.json"));
  console.log(`Loading Pyodide metadata from: ${pyodidePackagePath}`);

  const pyodideLockPath = path.join(pyodidePackagePath, "pyodide-lock.json");
  let packagesMeta;
  
  try {
    const content = await fs.readFile(pyodideLockPath, "utf-8");
    packagesMeta = JSON.parse(content);
    console.log(`✓ Loaded pyodide-lock.json`);
  } catch (error) {
    console.error("Could not load pyodide-lock.json:", error.message);
    process.exit(1);
  }

  // 4. Extract base URL and packages
  const pyodideInfo = packagesMeta.info || {};
  const pyodideVersion = pyodideInfo.version || "0.25.0";
  const archSuffix = pyodideInfo.arch || "wasm32";
  const pythonVersion = pyodideInfo.python || "3.11";
  
  // Construct the proper CDN URL for this version
  const baseUrl = `https://cdn.jsdelivr.net/pyodide/v${pyodideVersion}/full/`;
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Python version: ${pythonVersion}, Architecture: ${archSuffix}`);

  const packagesData = packagesMeta.packages || {};
  console.log(`Found ${Object.keys(packagesData).length} total packages in Pyodide distribution`);

  // 5. Recursively resolve dependencies
  function resolveDependencies(packageName, resolved = new Set(), resolving = new Set()) {
    if (resolved.has(packageName) || resolving.has(packageName)) {
      return resolved;
    }
    
    resolving.add(packageName);
    const pkgInfo = packagesData[packageName];
    
    if (pkgInfo && pkgInfo.depends) {
      pkgInfo.depends.forEach(dep => {
        resolveDependencies(dep, resolved, resolving);
      });
    }
    
    resolving.delete(packageName);
    resolved.add(packageName);
    return resolved;
  }

  // 6. Build complete dependency tree
  const allDependencies = new Set();
  requirements.forEach(req => {
    const deps = resolveDependencies(req);
    deps.forEach(dep => allDependencies.add(dep));
  });

  console.log(`Resolved dependencies: ${Array.from(allDependencies).join(', ')}`);
  console.log(`Total packages to vendor: ${allDependencies.size}`);

  // 7. Download all resolved packages
  let successCount = 0;
  let skipCount = 0;

  for (const packageName of allDependencies) {
    const pkgInfo = packagesData[packageName];
    
    if (!pkgInfo) {
      console.log(`⚠️  Package '${packageName}' not found in Pyodide distribution, skipping`);
      skipCount++;
      continue;
    }

    // Extract file name from package info
    const fileName = pkgInfo.file_name;
    if (!fileName) {
      console.log(`⚠️  No file_name for package '${packageName}', skipping`);
      skipCount++;
      continue;
    }

    const downloadUrl = `${baseUrl}${fileName}`;
    const localPath = path.join(vendorPath, fileName);

    console.log(`Downloading ${fileName}...`);
    
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const buffer = await response.arrayBuffer();
      await fs.writeFile(localPath, Buffer.from(buffer));
      
      console.log(`  ✓ Vendored ${fileName} (${(buffer.byteLength / 1024).toFixed(1)}KB)`);
      successCount++;
      
    } catch (error) {
      console.error(`  ✗ Failed to download ${fileName}: ${error.message}`);
      
      // Try alternative CDN paths
      const alternatives = [
        `https://files.pythonhosted.org/packages/py3/${packageName[0]}/${packageName}/${fileName}`,
        `https://cdn.jsdelivr.net/pyodide/v0.24.1/full/${fileName}`
      ];
      
      let downloaded = false;
      for (const altUrl of alternatives) {
        try {
          console.log(`    Trying alternative: ${altUrl}`);
          const response = await fetch(altUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            await fs.writeFile(localPath, Buffer.from(buffer));
            console.log(`    ✓ Downloaded from alternative source (${(buffer.byteLength / 1024).toFixed(1)}KB)`);
            successCount++;
            downloaded = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!downloaded) {
        console.error(`    ✗ All download attempts failed for ${packageName}`);
        skipCount++;
      }
    }
  }

  console.log("--- Vendor Complete ---");
  console.log(`Successfully vendored: ${successCount} packages`);
  console.log(`Skipped: ${skipCount} packages`);
  
  try {
    const vendoredFiles = await fs.readdir(vendorPath);
    console.log(`Total files in vendor directory: ${vendoredFiles.length}`);
    
    if (vendoredFiles.length > 0) {
      console.log("Vendored files:");
      vendoredFiles.forEach(file => console.log(`  - ${file}`));
    }
  } catch (error) {
    console.log("Vendor directory empty or inaccessible");
  }

  // 8. Create a manifest of what was vendored
  const manifest = {
    timestamp: new Date().toISOString(),
    pyodide_version: pyodideVersion,
    python_version: pythonVersion,
    architecture: archSuffix,
    requested_packages: requirements,
    resolved_packages: Array.from(allDependencies),
    vendored_count: successCount,
    skipped_count: skipCount
  };

  await fs.writeFile(
    path.join(vendorPath, "vendor-manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
  
  console.log("Vendor manifest created: vendor-manifest.json");
}

vendorDependencies().catch(err => {
  console.error("Vendor process failed:", err);
  process.exit(1);
});