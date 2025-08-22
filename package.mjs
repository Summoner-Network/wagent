import fs from "fs/promises";
import path from "path";
import * as tar from "tar";

/* ========== Structured Logger ========== */
function now() { return new Date().toISOString(); }
function log(event, data = {}, level = "info") {
  const rec = { ts: now(), stage: "package", level, event, ...data };
  process.stdout.write(JSON.stringify(rec) + "\n");
}
function fail(event, data = {}) {
  log(event, { ...data }, "error");
  process.exit(1);
}

/* ========== Helpers ========== */
async function sha256Path(p) {
  const crypto = await import("node:crypto");
  const buf = await fs.readFile(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function readJSON(p) { return JSON.parse(await fs.readFile(p, "utf-8")); }

async function listFilesRecursive(root) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

async function deterministicTar(srcDir, outFile) {
  // Tar by passing a sorted explicit list to ensure order determinism
  const files = await listFilesRecursive(srcDir);
  const rel = files.map(f => path.relative(srcDir, f));
  const tmp = outFile + ".tmp";
  await tar.create({
    cwd: srcDir,
    portable: true,
    noMtime: true,
    gzip: true,
    file: tmp
  }, rel);

  // sanity: list must be non-empty
  const listed = [];
  await tar.t({ file: tmp, onentry: e => listed.push(e.path) });
  if (listed.length === 0) fail("tar.empty", { srcDir });

  await fs.rename(tmp, outFile);
  return listed.length;
}

/* ========== Main ========== */
async function packageArtifacts() {
  log("begin");

  const dist = path.resolve("./dist");
  const pyodidePath = path.join(dist, "pyodide-wasm");
  const appPath = path.join(dist, "app");
  const vendorPath = path.resolve("./vendor");

  // inputs must exist
  for (const p of [pyodidePath, appPath, vendorPath]) {
    try { await fs.access(p); } catch { fail("input.missing", { path: p }); }
  }

  // Read pyodide versions from lock
  let info = {};
  try {
    const pkgRoot = path.dirname((await import("pyodide/package.json", { with: { type: "json" } })).default.url);
    const lockPath = path.join(new URL(pkgRoot).pathname, "pyodide-lock.json");
    const lock = await readJSON(lockPath);
    info = lock.info || {};
    log("pyodide.info", { version: info.version, python: info.python });
  } catch (e) {
    log("pyodide.info.warn", { err: String(e?.message || e) }, "warn");
  }

  const codeStage = path.join(dist, "_code_stage");
  const depsStage = path.join(dist, "_deps_stage");
  await fs.rm(codeStage, { recursive: true, force: true });
  await fs.rm(depsStage, { recursive: true, force: true });
  await fs.mkdir(codeStage, { recursive: true });
  await fs.mkdir(depsStage, { recursive: true });

  // Lay out deterministic structure
  await fs.mkdir(path.join(codeStage, "runtime"), { recursive: true });
  await fs.cp(pyodidePath, path.join(codeStage, "runtime", "pyodide-wasm"), { recursive: true });
  await fs.mkdir(path.join(codeStage, "app"), { recursive: true });
  await fs.cp(appPath, path.join(codeStage, "app"), { recursive: true });

  const vendorManifest = await readJSON(path.join(vendorPath, "vendor-manifest.json")).catch(() => ({}));
  await fs.cp(vendorPath, path.join(depsStage, "vendor"), { recursive: true });

  // Manifests
  const codeManifest = {
    schema_version: 1,
    pyodide_version: info.version || "unknown",
    python_version: info.python || "unknown",
    files: []
  };
  const depsManifest = {
    schema_version: 1,
    pyodide_version: info.version || "unknown",
    python_version: info.python || "unknown",
    ...vendorManifest
  };

  const codeManifestPath = path.join(dist, "code-manifest.json");
  const depsManifestPath = path.join(dist, "deps-manifest.json");

  await fs.writeFile(codeManifestPath, JSON.stringify(codeManifest, null, 2));
  await fs.writeFile(depsManifestPath, JSON.stringify(depsManifest, null, 2));

  // Archives
  const codeArchive = path.join(dist, "code-artifact.tar.gz");
  const depsArchive = path.join(dist, "deps-artifact.tar.gz");

  log("tar.begin", { artifact: "code", src: codeStage, out: codeArchive });
  const codeEntries = await deterministicTar(codeStage, codeArchive);
  log("tar.ok", { artifact: "code", entries: codeEntries });

  log("tar.begin", { artifact: "deps", src: depsStage, out: depsArchive });
  const depsEntries = await deterministicTar(depsStage, depsArchive);
  log("tar.ok", { artifact: "deps", entries: depsEntries });

  // Hash archives and persist in manifests
  const codeHash = await sha256Path(codeArchive);
  const depsHash = await sha256Path(depsArchive);

  await fs.writeFile(codeManifestPath, JSON.stringify({ ...codeManifest, archive_sha256: codeHash }, null, 2));
  await fs.writeFile(depsManifestPath, JSON.stringify({ ...depsManifest, archive_sha256: depsHash }, null, 2));

  log("complete", { codeArchive, codeHash, depsArchive, depsHash });
}

packageArtifacts().catch(err => fail("fatal", { err: String(err?.message || err) }));
