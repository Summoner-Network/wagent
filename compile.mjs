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

  // 1) Ensure pyodide present for a blank dir
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
      pyodidePackagePath,                      // 0.25.x layout
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

  // 3) Stage application source to dist/app and ensure agent packages
  try {
    await fs.mkdir(appStagePath, { recursive: true });
    
    // Copy main agent
    await copyDir(path.resolve("./agent"), path.join(appStagePath, "agent"));
    const initPath = path.join(appStagePath, "agent", "__init__.py");
    await fs.writeFile(initPath, "", { flag: "a" });
    
    // Copy multiplier agent and rename it to 'multiplier' module
    await copyDir(path.resolve("./agent-multiplier"), path.join(appStagePath, "multiplier"));
    const multiplierInitPath = path.join(appStagePath, "multiplier", "__init__.py");
    await fs.writeFile(multiplierInitPath, "", { flag: "a" });
    
    await fs.mkdir(path.join(appStagePath, "tapes"), { recursive: true });
    log("app.stage.ok", { appStagePath });
  } catch (e) {
    fail("app.stage.fail", { err: String(e?.message || e) });
  }

  log("complete", { distPath, pyodideWasmPath, appStagePath });
}

compile();