import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { execSync } from "child_process";

/* ========== Structured Logger ========== */
function now() { return new Date().toISOString(); }
function log(event, data = {}, level = "info") {
  const rec = { ts: now(), stage: "compile", level, event, ...data };
  process.stdout.write(JSON.stringify(rec) + "\n");
}
function fail(event, data = {}) {
  log(event, { ...data }, "error");
  process.exit(1);
}

/* ========== Utilities ========== */
const require = createRequire(import.meta.url);

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

async function discoverAgents(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const agents = [];
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const dirName = entry.name;
    let agentName = null;
    let sourcePath = path.join(rootDir, dirName);
    
    // Check if this is an agent directory
    if (dirName === "agent") {
      // Root agent - always maps to "agent"
      agentName = "agent";
    } else if (dirName.startsWith("agent-")) {
      // Named agent - extract name after "agent-"
      agentName = dirName.substring(6); // Remove "agent-" prefix
    } else {
      // Not an agent directory
      continue;
    }
    
    // Verify it has main.py
    const mainPyPath = path.join(sourcePath, "main.py");
    try {
      await fs.access(mainPyPath);
      agents.push({
        name: agentName,
        sourceDir: dirName,
        sourcePath: sourcePath,
        mainPy: mainPyPath
      });
      log("agent.discovered", { name: agentName, sourceDir: dirName });
    } catch {
      log("agent.skip.no_main", { sourceDir: dirName }, "warn");
    }
  }
  
  // Ensure we have a root agent
  const hasRootAgent = agents.some(a => a.name === "agent");
  if (!hasRootAgent) {
    fail("agent.missing.root", { 
      msg: "No root 'agent' directory found with main.py",
      discovered: agents.map(a => a.name)
    });
  }
  
  return agents;
}

function pkgVersionFromPackageJson(name, fallback = "^0.25.1") {
  try {
    const raw = require("fs").readFileSync(path.resolve("package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return (
      (pkg.dependencies && pkg.dependencies[name]) ||
      (pkg.devDependencies && pkg.devDependencies[name]) ||
      fallback
    );
  } catch {
    return fallback;
  }
}

function ensureNodeDep(pkgName, versionRange) {
  try {
    require.resolve(`${pkgName}/package.json`);
    log("dep.present", { pkgName });
    return;
  } catch {
    const version = versionRange || "latest";
    log("dep.install.begin", { pkgName, version });
    try {
      execSync(`npm install ${pkgName}@${version} --no-audit --no-fund --silent`, { stdio: "inherit" });
      require.resolve(`${pkgName}/package.json`);
      log("dep.install.ok", { pkgName, version });
    } catch (e) {
      fail("dep.install.fail", { pkgName, version, err: String(e?.message || e) });
    }
  }
}

/* ========== Main ========== */
async function compile() {
  log("begin");

  // 1) Ensure pyodide present
  const desiredPyodide = pkgVersionFromPackageJson("pyodide", "^0.25.1");
  ensureNodeDep("pyodide", desiredPyodide);

  const distPath = path.resolve("./dist");
  const pyodideWasmPath = path.join(distPath, "pyodide-wasm");
  const appStagePath = path.join(distPath, "app");

  await fs.rm(distPath, { recursive: true, force: true });
  await fs.mkdir(pyodideWasmPath, { recursive: true });

  // 2) Locate and copy Pyodide runtime
  try {
    const pyodidePackagePath = path.dirname(require.resolve("pyodide/package.json"));
    log("pyodide.located", { pyodidePackagePath });

    const candidates = [
      pyodidePackagePath,
      path.join(pyodidePackagePath, "dist"),
      path.join(pyodidePackagePath, "pyodide"),
    ];

    let src = null;
    for (const p of candidates) {
      try {
        const items = await fs.readdir(p);
        const hasWasm = items.some(f => f.includes(".wasm"));
        const hasJs = items.some(f => f.includes("pyodide.js") || f.includes("pyodide.mjs"));
        if (hasWasm && hasJs) { src = p; log("pyodide.files.found", { path: p, items }); break; }
      } catch { /* ignore */ }
    }
    if (!src) fail("pyodide.files.missing");

    await fs.cp(src, pyodideWasmPath, { recursive: true });
    log("pyodide.copy.ok", { to: pyodideWasmPath });
  } catch (error) {
    fail("pyodide.copy.fail", { err: String(error?.message || error) });
  }

  // 3) Discover and stage all agents
  try {
    await fs.mkdir(appStagePath, { recursive: true });
    
    const rootDir = path.resolve(".");
    const agents = await discoverAgents(rootDir);
    
    log("agents.discovered", { 
      count: agents.length, 
      agents: agents.map(a => ({ name: a.name, sourceDir: a.sourceDir }))
    });
    
    // Stage each agent
    for (const agent of agents) {
      const targetPath = path.join(appStagePath, agent.name);
      await copyDir(agent.sourcePath, targetPath);
      
      // Ensure Python package structure
      const initPath = path.join(targetPath, "__init__.py");
      await fs.writeFile(initPath, "", { flag: "a" });
      
      log("agent.staged", { 
        name: agent.name, 
        sourceDir: agent.sourceDir,
        targetPath: path.relative(appStagePath, targetPath)
      });
    }
    
    // Create tapes directory
    await fs.mkdir(path.join(appStagePath, "tapes"), { recursive: true });
    
    // Write agent registry for runtime
    const agentRegistry = {
      agents: agents.map(a => ({
        name: a.name,
        sourceDir: a.sourceDir,
        modulePath: `${a.name}.main`
      })),
      rootAgent: "agent"
    };
    
    await fs.writeFile(
      path.join(appStagePath, "agent_registry.json"), 
      JSON.stringify(agentRegistry, null, 2)
    );
    
    log("app.stage.ok", { 
      appStagePath, 
      agentsStaged: agents.length,
      rootAgent: "agent"
    });
  } catch (e) {
    fail("app.stage.fail", { err: String(e?.message || e) });
  }

  log("complete", { distPath, pyodideWasmPath, appStagePath });
}

compile();