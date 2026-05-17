/**
 * Single place for “where is the PDEU digital twin package?” lookup.
 *
 * Supports:
 * - Repo-root `pdeu_digitaltwin` / `pdeu_digitaltwin ` (trailing-space folder name).
 * - `final_pdpu_onnx_timvx/pdeu_digitaltwin/pdeu_digitaltwin /...` (and without trailing space).
 * - Any other top-level directory whose name starts with `final_` and contains the same
 *   nested layout (handles renames such as typos in “pdpu/onnx/timvx”).
 */

const fs = require("fs");
const path = require("path");

/** Inner twin package folder names observed in exports (sometimes a trailing space in the dirname). */
const INNER_NAMES = ["pdeu_digitaltwin ", "pdeu_digitaltwin"];

/** Explicit roots like `final_pdpu_onnx_timvx` plus common typo variants before dynamic scan. */
const FINAL_PREFIXES_EXPLICIT = [
  "final_pdpu_onnx_timvx",
  "final_pdeu_onnx_timvx",
  "final_pdpu_onnx_timevx",
  "final_pdeu_onnx_timevx",
  "final_pdeu_innx_timvx",
  "final_pdeu_innx_timevx",
];

function isTwinDir(absDir) {
  return (
    typeof absDir === "string" &&
    fs.existsSync(path.join(absDir, "server.js")) &&
    fs.existsSync(path.join(absDir, "package.json")) &&
    fs.existsSync(path.join(absDir, "three.html"))
  );
}

/**
 * @param {string} repoRoot
 * @returns {string|null} Absolute path to twin folder containing server.js, package.json, and three.html
 */
function resolvePdeuDigitalTwinDir(repoRoot) {
  /** @type {string[]} */
  const seen = [];

  function tryCandidate(absDir) {
    if (!absDir || seen.includes(absDir)) return null;
    seen.push(absDir);
    return isTwinDir(absDir) ? absDir : null;
  }

  // 1) Prefer final_* trees (real export layout) so a broken repo-root "pdeu_digitaltwin " stub is not chosen.
  for (const pref of FINAL_PREFIXES_EXPLICIT) {
    const mid = path.join(repoRoot, pref, "pdeu_digitaltwin");
    for (const inner of INNER_NAMES) {
      const hit = tryCandidate(path.join(mid, inner));
      if (hit) return hit;
    }
    const hitMidOnly = tryCandidate(mid);
    if (hitMidOnly) return hitMidOnly;
  }

  // 2) Scan any other top-level final_* directory
  try {
    for (const ent of fs.readdirSync(repoRoot, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith(".")) continue;
      if (!/^final_/i.test(ent.name)) continue;
      if (FINAL_PREFIXES_EXPLICIT.includes(ent.name)) continue;
      const mid = path.join(repoRoot, ent.name, "pdeu_digitaltwin");
      if (!fs.existsSync(mid)) continue;
      for (const inner of INNER_NAMES) {
        const hit = tryCandidate(path.join(mid, inner));
        if (hit) return hit;
      }
      const hitMidOnly = tryCandidate(mid);
      if (hitMidOnly) return hitMidOnly;
    }
  } catch {
    /* ignore */
  }

  // 3) Last resort: repo-root pdeu_digitaltwin (only if complete, including three.html)
  for (const inner of INNER_NAMES) {
    const hit = tryCandidate(path.join(repoRoot, inner));
    if (hit) return hit;
  }

  return null;
}

module.exports = { resolvePdeuDigitalTwinDir, INNER_NAMES };

if (require.main === module) {
  const repoRoot = path.join(__dirname, "..");
  const twinDir = resolvePdeuDigitalTwinDir(repoRoot);
  if (!twinDir) {
    console.error(
      "[pdeu-twin-resolve] Could not locate digital twin folder (need server.js, package.json, three.html).",
    );
    process.exit(1);
  }
  process.stdout.write(twinDir);
}
