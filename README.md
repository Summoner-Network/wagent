# Multi-Agent WebAssembly Runner

A self-contained system for building, packaging, and running chains of interconnected Python agents within a secure Node.js runtime using WebAssembly (WASM).

## 🚀 Quick Start

### Prerequisites
- Node.js (version 16+)
- npm

### Installation & Setup

```bash
# 1. Install dependencies
npm install

# 2. Build artifacts
npm run build

# 3. Run the system
npm start
```

## 📁 Project Structure

```
├── agent/                  # Primary/root agent source code
├── agent-multiplier/       # Secondary helper agent
├── compile.mjs            # Agent discovery and staging
├── vendor.mjs             # Python package dependency manager
├── package.mjs            # Artifact creation with crypto hashing
├── run.mjs                # Production runtime orchestrator
├── package.json           # Node.js project configuration
└── dist/                  # Generated artifacts (created after build)
    ├── code-artifact.tar.gz
    ├── deps-artifact.tar.gz
    └── manifest files with SHA256 hashes
```

## 🔄 System Workflow

### Build Phase (`npm run build`)
1. **Discovery**: `compile.mjs` finds all `agent*` directories
2. **Vendoring**: `vendor.mjs` downloads Python dependencies as WASM wheels
3. **Packaging**: `package.mjs` creates cryptographically signed artifacts

### Runtime Phase (`npm start`)
1. **Verification**: SHA256 hash validation of artifacts
2. **Environment**: Pyodide WASM sandbox initialization
3. **Deployment**: Virtual filesystem creation and package installation
4. **Orchestration**: Multi-agent workflow execution

## 🛠 Troubleshooting

### Common Issues

**Build Failures:**
```bash
# Clean build artifacts and retry
rm -rf dist/
npm run build
```

**Runtime Errors:**
- Verify artifact integrity: Check SHA256 hashes in manifest files
- Ensure Python dependencies are compatible with Pyodide
- Check agent main.py files have proper `main(config)` function

**Production Issues:**
- Verify Node.js version compatibility
- Check memory limits for WASM environment
- Validate network access for dependency downloads

### Health Checks
```bash
# Verify artifacts exist
ls -la dist/

# Check artifact integrity
cat dist/code-manifest.json
cat dist/deps-manifest.json
```

## 📝 Adding New Agents

1. **Create Agent Directory**
   ```bash
   mkdir agent-{your-agent-name}
   cd agent-{your-agent-name}
   ```

2. **Add Required Files**
   ```python
   # main.py - Must contain main(config) function
   def main(config):
       # Your agent logic here
       return agent_instance
   
   class YourAgent:
       def run(self):
           # Agent execution logic
           pass
   ```
   
   ```txt
   # requirements.txt - Python dependencies
   numpy==1.24.0
   requests==2.28.0
   ```

3. **Rebuild System**
   ```bash
   npm run build
   ```

## 🔧 Architecture Details

### Security Features
- **Sandboxed Execution**: All Python code runs in isolated WASM environment
- **Cryptographic Verification**: SHA256 hashing ensures artifact integrity
- **No Host Python Required**: Self-contained WebAssembly runtime

### Agent Communication
- Agents communicate through the orchestration layer
- Task delegation follows a chain-of-responsibility pattern
- JSON-structured logging for full workflow visibility

### Performance Considerations
- WASM initialization has startup overhead
- Python package loading happens at runtime
- Memory usage scales with number of concurrent agents