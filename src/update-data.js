import fs from "fs";
import path from "path";
import { DATA_MANIFEST_NAME } from "./import-util.js";

const STATE_FILE = ".gp-deploy-state.json";

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
};

/** The file names (relative to the importer's data folder) the last generation staged. */
export function previousDataFiles(outputDir) {
  const manifest = readJson(
    path.join(outputDir, "deploy", "importer", "data", DATA_MANIFEST_NAME)
  );
  return manifest?.files ? Object.keys(manifest.files) : null;
}

/**
 * Whether new data can go into the running app without generating it again. Only data
 * with the same shape can: same layers, same fields with the same types. Anything else
 * changes the app itself (tables, entities, screens) and needs a full deploy.
 *
 * @param {Object} args
 * @param {String} args.outputDir the generated product of the last deployment
 * @param {String} args.fingerprint data-model fingerprint of the data to load
 * @param {String[]} args.plannedFiles the importer files the data would produce
 * @returns {{ok: true} | {ok: false, reason: String}}
 */
export function checkDataUpdate({ outputDir, fingerprint, plannedFiles }) {
  const state = readJson(path.join(outputDir, STATE_FILE));
  const previous = previousDataFiles(outputDir);
  if (!state?.dataModel || !previous) {
    return {
      ok: false,
      reason:
        "This app has not been deployed from here yet: deploy it first, then update its data.",
    };
  }
  if (state.dataModel !== fingerprint) {
    return {
      ok: false,
      reason:
        "The layers' fields changed since the last deployment (a field was added, removed, renamed or changed type): use Deploy, the app has to be regenerated.",
    };
  }
  const before = new Set(previous);
  const now = new Set(plannedFiles);
  const added = [...now].filter((f) => !before.has(f));
  const removed = [...before].filter((f) => !now.has(f));
  if (added.length > 0 || removed.length > 0) {
    const names = [...added, ...removed].slice(0, 3).join(", ");
    return {
      ok: false,
      reason: `Layers were added or removed since the last deployment (${names}): use Deploy, the app has to be regenerated.`,
    };
  }
  return { ok: true };
}
