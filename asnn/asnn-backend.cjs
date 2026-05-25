/**
 * ASNN dashboard inference (person.py + detect.py) mounted at /asnn in Forge auth-server.
 * Models live in asnn-dashboard/models — separate from universal/models.
 */
const path = require("path");
const { createUniversalState } = require("../universal/universal-backend.cjs");

function defaultAsnnPaths() {
  const root = path.resolve(__dirname, "..");
  const base = path.join(root, "asnn-dashboard");
  return {
    modelsDir: process.env.ASNN_MODELS_DIR ? path.resolve(process.env.ASNN_MODELS_DIR) : path.join(base, "models"),
    uploadsDir: process.env.ASNN_UPLOADS_DIR
      ? path.resolve(process.env.ASNN_UPLOADS_DIR)
      : path.join(base, "uploads"),
    detectScript: process.env.ASNN_DETECT_SCRIPT
      ? path.resolve(process.env.ASNN_DETECT_SCRIPT)
      : path.join(base, "detect.py"),
    personScript: process.env.ASNN_PERSON_SCRIPT
      ? path.resolve(process.env.ASNN_PERSON_SCRIPT)
      : path.join(base, "person.py"),
  };
}

function createAsnnState(paths) {
  const p = paths || defaultAsnnPaths();
  return createUniversalState({
    modelsDir: p.modelsDir,
    uploadsDir: p.uploadsDir,
    detectScript: p.detectScript,
    personScript: p.personScript,
    wsPath: "/asnn",
  });
}

module.exports = { defaultAsnnPaths, createAsnnState };
