import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";

/* ========== Structured Logger ========== */
function now() { return new Date().toISOString(); }
function log(event, data = {}, level = "info") {
  const rec = { ts: now(), stage: "vendor", level, event, ...data };
  process.stdout.write(JSON.stringify(rec) + "\n");
}
function fail(event, data = {}) {
  log(event, { ...data }, "error");
  process.exit(1);
}

/* ========== Utilities ========== */
const require = createRequire(import.meta.url);

async function readJSON(p) { return JSON.parse(await fs.readFile(p, "utf-8")); }

async function sha256(buf) {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function fetchToFile(url, outPath, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const arr = new Uint8Array(await res.arrayBuffer());
      await fs.writeFile(outPath, arr);
      return arr.length;
    } catch (e) {
      log("download.retry", { url, attempt: i, err: String(e?.message || e) }, "warn");
      if (i === attempts) throw e;
    }
  }
}

/* Resolve full dependency closure using pyodide-lock.json */
function resolveDependencies(rootPkgs, packagesData) {
  const resolved = new Set();
  const stack = [...rootPkgs];
  while (stack.length) {
    const name = stack.pop();
    if (resolved.has(name)) continue;
    const info = packagesData[name];
    if (!info) {
      // not in Pyodide distribution
      log("pkg.missing.in.lock", { name }, "warn");
      continue;
    }
    resolved.add(name);
    const deps = Array.from(info.depends || []);
    for (const d of deps) stack.push(d);
  }
  return Array.from(resolved);
}

/* ========== Main ========== */
async function vendorDependencies() {
  log("begin");
  const vendorPath = path.resolve("./vendor");
  await fs.rm(vendorPath, { recursive: true, force: true });
  await fs.mkdir(vendorPath, { recursive: true });

  // 1) Collect requirements from all agent*/requirements.txt
  const rootDir = path.resolve(".");
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const agentDirs = entries.filter(e => e.isDirectory() && e.name.startsWith("agent")).map(e => e.name);

  const discovered = new Set();
  for (const d of agentDirs) {
    const reqPath = path.join(d, "requirements.txt");
    try {
      const content = await fs.readFile(reqPath, "utf-8");
      content
        .split("\n")
        .map(s => s.trim())
        .filter(Boolean)
        .forEach(x => discovered.add(x));
      log("requirements.found", { dir: d, count: content.split("\n").filter(Boolean).length });
    } catch {
      // missing file is fine
    }
  }

  // Bootstrap packages for offline micropip flow
  ["micropip", "packaging"].forEach(x => discovered.add(x));

  const requested = Array.from(discovered).sort();
  log("requirements.combined", { requested });

  // 2) Load pyodide-lock.json via createRequire to avoid cwd issues
  let packagesMeta;
  let lockPath;
  try {
    const pyodidePackagePath = path.dirname(require.resolve("pyodide/package.json"));
    lockPath = path.join(pyodidePackagePath, "pyodide-lock.json");
    packagesMeta = await readJSON(lockPath);
    log("pyodide.lock.loaded", { lockPath });
  } catch (e) {
    fail("pyodide.lock.read.fail", { err: String(e?.message || e), lockPath });
  }

  const info = packagesMeta.info || {};
  const baseUrl = `https://cdn.jsdelivr.net/pyodide/v${info.version}/full/`;
  const packagesData = packagesMeta.packages || {};
  log("pyodide.meta", { version: info.version, python: info.python, baseUrl });

  // 3) Resolve closure and download wheels
  const closure = resolveDependencies(requested, packagesData).sort();
  log("deps.resolved", { total: closure.length, closure });

  let ok = 0, skip = 0;
  for (const name of closure) {
    const pkg = packagesData[name];
    if (!pkg || !pkg.file_name) {
      log("pkg.skip", { name }, "warn");
      skip++;
      continue;
    }
    const filename = pkg.file_name;
    const url = `${baseUrl}${filename}`;
    const out = path.join(vendorPath, filename);

    log("download.begin", { name, filename, url });
    try {
      const bytes = await fetchToFile(url, out, 3);
      const buf = await fs.readFile(out);
      const hash = await sha256(buf);
      log("download.ok", { name, filename, bytes, sha256: hash });
      ok++;
    } catch (e) {
      log("download.fail", { name, filename, err: String(e?.message || e) }, "error");
      skip++;
    }
  }

  // 4) Build manifest with per-file hashes
  const files = (await fs.readdir(vendorPath))
    .filter(f => f.endsWith(".whl"))
    .sort();

  const filesMeta = [];
  for (const f of files) {
    const p = path.join(vendorPath, f);
    const st = await fs.stat(p);
    const buf = await fs.readFile(p);
    const hash = await sha256(buf);
    filesMeta.push({ filename: f, size: st.size, sha256: hash });
  }

  const manifest = {
    timestamp: new Date().toISOString(),
    pyodide_version: info.version,
    python_version: info.python,
    requested_packages: requested,
    resolved_packages: closure,
    files: filesMeta
  };

  await fs.writeFile(path.join(vendorPath, "vendor-manifest.json"), JSON.stringify(manifest, null, 2));
  log("manifest.written", { vendorPath, ok, skip, files: files.length });
  log("complete");
}

vendorDependencies().catch(err => {
  fail("fatal", { err: String(err?.message || err) });
});
