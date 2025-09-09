import { loadPyodide } from "pyodide";
import fs from "fs/promises";
import path from "path";
import * as tar from "tar";
import crypto from "crypto";

/* ========== Structured Logger ========== */
function now() { return new Date().toISOString(); }
function log(event, data = {}, level = "info") {
  const rec = { ts: now(), stage: "run", level, event, ...data };
  process.stdout.write(JSON.stringify(rec) + "\n");
}
function fail(event, data = {}) {
  log(event, { ...data }, "error");
  process.exit(1);
}

/* ========== Paths ========== */
const DIST = path.resolve("./dist");
const CODE_ARCHIVE = path.join(DIST, "code-artifact.tar.gz");
const DEPS_ARCHIVE = path.join(DIST, "deps-artifact.tar.gz");
const CODE_MANIFEST = path.join(DIST, "code-manifest.json");
const DEPS_MANIFEST = path.join(DIST, "deps-manifest.json");

const UNPACK_ROOT = path.join(DIST, "_artifacts");
const CODE_UNPACK = path.join(UNPACK_ROOT, "code");
const DEPS_UNPACK = path.join(UNPACK_ROOT, "deps");

/* ========== Agent Registry ========== */
let agentRegistry = null;

async function loadAgentRegistry(pyodide) {
  try {
    const registryData = pyodide.FS.readFile("/app/agent_registry.json", { encoding: "utf8" });
    agentRegistry = JSON.parse(registryData);
    log("agent.registry.loaded", {
      agentCount: agentRegistry.agents.length,
      rootAgent: agentRegistry.rootAgent,
      agents: agentRegistry.agents.map(a => a.name)
    });
    return agentRegistry;
  } catch (e) {
    fail("agent.registry.load.fail", { err: String(e?.message || e) });
  }
}

function getAgentModulePath(agentName) {
  if (!agentRegistry) {
    fail("agent.registry.not.loaded");
  }

  const agent = agentRegistry.agents.find(a => a.name === agentName);
  if (!agent) {
    fail("agent.not.found", {
      agentName,
      available: agentRegistry.agents.map(a => a.name)
    });
  }

  return agent.modulePath;
}

/* ========== Helpers ========== */
async function sha256(filePath) {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function ensureFile(p) {
  try { await fs.access(p); } catch { fail("file.missing", { path: p }); }
}

async function verifyArchive(archivePath, manifestPath, key = "archive_sha256") {
  await ensureFile(archivePath);
  await ensureFile(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const have = await sha256(archivePath);
  const want = manifest[key];
  if (!want) fail("manifest.key.missing", { manifestPath, key });
  if (want !== have) fail("archive.hash.mismatch", { archive: path.basename(archivePath), want, have });
  log("archive.verified", { archive: path.basename(archivePath), sha256: have });
  return manifest;
}

async function cleanUnpack() {
  await fs.rm(UNPACK_ROOT, { recursive: true, force: true });
  await fs.mkdir(CODE_UNPACK, { recursive: true });
  await fs.mkdir(DEPS_UNPACK, { recursive: true });
}

async function unpack() {
  log("unpack.begin", { archive: path.basename(CODE_ARCHIVE) });
  await tar.x({ file: CODE_ARCHIVE, cwd: CODE_UNPACK, strip: 0 });
  log("unpack.begin", { archive: path.basename(DEPS_ARCHIVE) });
  await tar.x({ file: DEPS_ARCHIVE, cwd: DEPS_UNPACK, strip: 0 });
  log("unpack.complete");
}

async function writeDirToVFS(pyodide, localDir, vfsDir) {
  const FS = pyodide.FS;
  try { FS.mkdirTree(vfsDir); } catch {}
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  for (const e of entries) {
    const lp = path.join(localDir, e.name);
    const vp = path.join(vfsDir, e.name);
    if (e.isDirectory()) await writeDirToVFS(pyodide, lp, vp);
    else {
      const data = await fs.readFile(lp);
      FS.writeFile(vp, data);
    }
  }
}

async function stageWheelsToVFS(pyodide, hostVendorDir) {
  const names = (await fs.readdir(hostVendorDir)).filter(f => f.endsWith(".whl")).sort();
  for (const f of names) {
    const data = await fs.readFile(path.join(hostVendorDir, f));
    pyodide.FS.writeFile(`/tmp/wheels/${f}`, data);
  }
  return names;
}

/* Install a wheel into site-packages without micropip (bootstrap) */
function wheelInstallPyCode(wheelPath, sitePackages) {
  return `
import sys, os, zipfile, shutil
wheel = "${wheelPath}"
target = "${sitePackages}"
os.makedirs(target, exist_ok=True)
with zipfile.ZipFile(wheel) as z:
    z.extractall(target)
# Normalize .data layout if present
data_dir = None
for n in os.listdir(target):
    if n.endswith('.data'):
        data_dir = os.path.join(target, n)
        break
if data_dir and os.path.isdir(data_dir):
    for sub in ('purelib','platlib','data'):
        p = os.path.join(data_dir, sub)
        if os.path.isdir(p):
            for root, dirs, files in os.walk(p):
                rel = os.path.relpath(root, p)
                dst = os.path.join(target, rel)
                os.makedirs(dst, exist_ok=True)
                for fn in files:
                    shutil.move(os.path.join(root, fn), os.path.join(dst, fn))
    shutil.rmtree(data_dir, ignore_errors=True)
print("BOOTSTRAP_WHEEL_INSTALLED", wheel)
  `.trim();
}

async function installBootstrap(pyodide, wheelNames) {
  const sitePackages = "/lib/python3.11/site-packages";
  pyodide.FS.mkdirTree("/tmp/wheels");
  const need = ["micropip", "packaging"];

  const chosen = wheelNames.filter(n =>
    need.some(k => n.startsWith(`${k}-`))
  );
  if (chosen.length === 0) {
    log("bootstrap.warn", { msg: "no bootstrap wheels found, will attempt import" }, "warn");
    return;
  }

  for (const w of chosen) {
    const cmd = wheelInstallPyCode(`/tmp/wheels/${w}`, sitePackages);
    try {
      pyodide.runPython(cmd);
      log("bootstrap.wheel.installed", { wheel: w });
    } catch (e) {
      fail("bootstrap.wheel.fail", { wheel: w, err: String(e?.message || e) });
    }
  }

  try {
    pyodide.runPython("import micropip, packaging; print('BOOTSTRAP_OK', micropip.__version__)");
    log("bootstrap.ok");
  } catch (e) {
    fail("bootstrap.import.fail", { err: String(e?.message || e) });
  }
}

async function installRemainingWithMicropip(pyodide, wheelNames) {
  await installMicropipIfMissing(pyodide);

  const micropip = pyodide.pyimport("micropip");
  const rest = wheelNames.filter(n => !n.startsWith("micropip-") && !n.startsWith("packaging-"));
  for (const wheel of rest) {
    log("micropip.install.begin", { wheel });
    try {
      await micropip.install(`emfs:/tmp/wheels/${wheel}`);
      log("micropip.install.ok", { wheel });
    } catch (e) {
      fail("micropip.install.fail", { wheel, err: String(e?.message || e) });
    }
  }
}

async function installMicropipIfMissing(pyodide) {
  try {
    pyodide.runPython("import micropip");
  } catch {
    try { pyodide.runPython("import micropip"); }
    catch (e) { fail("micropip.absent.postbootstrap", { err: String(e?.message || e) }); }
  }
}

async function executeAgentTask(pyodide, agentName, inputData, agentConfig = {}, hostCapabilities = {}) {
  log("agent.exec.begin", { agentName });

  const vfsTapesPath = "/tapes";
  const inputTapePath = path.join(vfsTapesPath, "in.json");
  const outputTapePath = path.join(vfsTapesPath, "out.json");

  // Get module path from registry
  const agentModulePath = getAgentModulePath(agentName);
  log("agent.module.resolve", { agentName, modulePath: agentModulePath });

  try {
    // Import the agent module
    const agentModule = pyodide.pyimport(agentModulePath);

    // Create agent instance with config and host capabilities
    const agentInstance = agentModule.main(
      pyodide.toPy(agentConfig),
      pyodide.toPy(hostCapabilities)
    );

    const traceId = crypto.randomUUID();
    const tapeInput = { trace_id: traceId, payload: inputData };

    pyodide.FS.mkdirTree(vfsTapesPath);
    pyodide.FS.writeFile(inputTapePath, JSON.stringify(tapeInput));

    // Execute agent
    agentInstance.run(inputTapePath, outputTapePath);

    const resultRaw = pyodide.FS.readFile(outputTapePath, { encoding: "utf8" });
    const resultData = JSON.parse(resultRaw);

    if (resultData.trace_id !== traceId) {
      fail("trace.mismatch", { expect: traceId, got: resultData.trace_id });
    }

    log("agent.exec.ok", { agentName, status: resultData.status });
    return resultData;

  } catch (e) {
    fail("agent.exec.fail", {
      agentName,
      modulePath: agentModulePath,
      err: String(e?.message || e)
    });
  }
}

/* ========== Main Orchestration ========== */
async function main() {
  log("begin", { mode: "artifact-driven-dynamic" });

  // 1) Verify artifacts
  await verifyArchive(CODE_ARCHIVE, CODE_MANIFEST);
  await verifyArchive(DEPS_ARCHIVE, DEPS_MANIFEST);

  // 2) Unpack artifacts
  await cleanUnpack();
  await unpack();

  // 3) Boot Pyodide from code runtime
  const runtimeHostPath = path.join(CODE_UNPACK, "runtime", "pyodide-wasm");
  await fs.access(runtimeHostPath).catch(() => fail("runtime.missing", { runtimeHostPath }));
  const pyodide = await loadPyodide({
    indexURL: runtimeHostPath,
    stdout: t => log("python.stdout", { msg: t.trim() }),
    stderr: t => log("python.stderr", { msg: t.trim() }, "warn")
  });
  log("pyodide.loaded");

  // 4) Load app to VFS and set sys.path
  const appHostPath = path.join(CODE_UNPACK, "app");
  await writeDirToVFS(pyodide, appHostPath, "/app");
  pyodide.runPython(`
import sys
if '/app' not in sys.path:
    sys.path.append('/app')
print('PY_PATH_OK', '/app' in sys.path)
  `.trim());
  log("app.vfs.ready");

  // 5) Define and register host capabilities as a Python module
  const hostCapabilities = {
    getHostInfo: () => {
      log("host.capability.called", { function: "getHostInfo" });
      return "Hello from the Node.js Host! Version: " + process.version;
    },
  };
  // CORRECT: Use registerJsModule to make the object importable in Python
  pyodide.registerJsModule("host", hostCapabilities);
  log("host.capabilities.injected", { capabilities: Object.keys(hostCapabilities) });


  // 6) Load agent registry
  await loadAgentRegistry(pyodide);

  // 7) Stage wheels and install dependencies
  const hostVendorDir = path.join(DEPS_UNPACK, "vendor");
  pyodide.FS.mkdirTree("/tmp/wheels");
  const wheelNames = await stageWheelsToVFS(pyodide, hostVendorDir);
  log("wheels.staged", { count: wheelNames.length });

  await installBootstrap(pyodide, wheelNames);
  await installRemainingWithMicropip(pyodide, wheelNames);

  // 8) Boot audits
  try {
    pyodide.runPython("import sys; print('✅ Python', sys.version.split()[0])");
    log("audit.python.ok");

    // Test import of available packages
    try {
      pyodide.runPython("import numpy; print('✅ NumPy', numpy.__version__)");
      log("audit.numpy.ok");
    } catch {
      log("audit.numpy.skip", {}, "warn");
    }
  } catch (e) {
    fail("audit.python.fail", { err: String(e?.message || e) });
  }

  // 9) Orchestration loop - start with root agent
  const rootAgentName = agentRegistry.rootAgent;
  let nextTask = {
    agentName: rootAgentName,
    inputData: { vector: [2, 4, 6] },
    agentConfig: { vector: [1, 1, 1], target_threshold: 100 }
  };
  let finalResult = null;
  let stepCount = 0;
  const maxSteps = 20;

  // Track progress for infinite loop detection
  let progressHistory = [];
  let stagnantSteps = 0;
  const maxStagnantSteps = 5;

  log("workflow.start", { rootAgent: rootAgentName, targetThreshold: 100 });

  while (nextTask && stepCount < maxSteps) {
    stepCount++;
    log("workflow.step", { step: stepCount, agentName: nextTask.agentName });

    const res = await executeAgentTask(
      pyodide,
      nextTask.agentName,
      nextTask.inputData,
      nextTask.agentConfig || {},
      hostCapabilities
    );

    if (res.status === "complete") {
      finalResult = res.result;
      log("workflow.complete", { result: finalResult, steps: stepCount, progressHistory });
      nextTask = null;
    } else if (res.status === "pending" && res.action?.type === "run_agent") {
      const p = res.action.payload;

      // Track progress to detect infinite loops
      const currentProgress = p.input_data.processed_result || p.input_data.number || 0;
      progressHistory.push({ step: stepCount, agent: nextTask.agentName, progress: currentProgress });

      // Check if we're making progress
      if (progressHistory.length >= 2) {
        const lastProgress = progressHistory[progressHistory.length - 2].progress;
        if (currentProgress <= lastProgress) {
          stagnantSteps++;
        } else {
          stagnantSteps = 0; // Reset if we made progress
        }
      }

      if (stagnantSteps >= maxStagnantSteps) {
        fail("workflow.stagnant", {
          stagnantSteps,
          maxStagnantSteps,
          progressHistory,
          msg: "Workflow appears stuck - no progress being made"
        });
      }

      log("workflow.pending", {
        next: p.agent_name,
        step: stepCount,
        currentProgress,
        stagnantSteps
      });

      nextTask = {
        agentName: p.agent_name,
        inputData: p.input_data,
        agentConfig: p.agent_config || {}
      };
    } else {
      fail("agent.response.invalid", { res, step: stepCount });
    }
  }

  if (stepCount >= maxSteps) {
    fail("workflow.max.steps", {
      maxSteps,
      finalStep: stepCount,
      progressHistory,
      msg: "Reached maximum workflow steps"
    });
  }

  log("end", { finalResult, totalSteps: stepCount });
}

main().catch(err => fail("fatal", { err: String(err?.message || err) }));


