import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fileHash, zipContentHash } from "./data-hash.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMPORTER_DEST_RELATIVE = path.join("deploy", "importer");

// Content hash of every staged file, read by the importer (templates/import.mjs) to
// decide which layers changed since it last loaded them.
export const DATA_MANIFEST_NAME = "manifest.json";

const posix = (p) => p.split(path.sep).join("/");

/**
 * The importer's data folder (<outputFolder>/deploy/importer/data) across every folder
 * staged in one run. Files whose content is unchanged since the previous run are left
 * untouched -- same bytes, same mtime -- so a redeploy doesn't recopy hundreds of MB and
 * the ssh upload's own diff sees nothing to send. `finish()` drops the files of layers
 * that are gone and writes the manifest.
 */
export function createImportStaging(outputFolder) {
  const dataFolder = path.join(outputFolder, IMPORTER_DEST_RELATIVE, "data");
  const manifestPath = path.join(dataFolder, DATA_MANIFEST_NAME);

  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(manifestPath, "utf-8")).files || {};
  } catch {
    // no previous run, or a manifest from before this existed: copy everything
  }

  const files = {};

  return {
    dataFolder,
    files,

    /** Copies `source` to `<dataFolder>/<relative>` unless the same content is there. */
    stage(relative, source, hash) {
      const key = posix(relative);
      const dest = path.join(dataFolder, relative);
      files[key] = hash;
      if (previous[key] === hash && fs.existsSync(dest)) return;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(source, dest);
    },

    /**
     * `extra` goes into the manifest next to the hashes: `editable` (file names of the layers
     * people change in the web app) and `overwriteEdited` (load them anyway).
     */
    finish(extra = {}) {
      if (Object.keys(files).length === 0) {
        // Generation doesn't wipe old output: without this, a project whose layers
        // were all removed would still import them.
        fs.rmSync(dataFolder, { recursive: true, force: true });
        return;
      }
      removeStale(dataFolder, dataFolder, files);
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ version: 1, files, ...extra }, null, 2),
        "utf-8"
      );
    },
  };
}

function removeStale(root, dir, keep) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeStale(root, full, keep);
      if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } else if (
      !(posix(path.relative(root, full)) in keep) &&
      entry.name !== DATA_MANIFEST_NAME
    ) {
      fs.rmSync(full, { force: true });
    }
  }
}

/**
 * What the importer must know about layers edited on the web: their file names, so a
 * redeploy does not replace the rows people changed, and whether to replace them anyway
 * (`deploy.overwriteEditedLayers`). Empty when no layer is editable.
 */
export function editedLayersInfo(manifest, deploy = {}) {
  const editable = Object.values(manifest?.layersByStaged || {})
    .filter((entry) => entry.editable === true)
    .map((entry) => `${entry.staged}.zip`);
  if (editable.length === 0) return {};
  return { editable, overwriteEdited: deploy?.overwriteEditedLayers === true };
}

/**
 * The importer files (`{relative path: hash}`) staging `geographicFilesFolders` would
 * produce, without copying any data: what `--update-data` compares with the last run.
 */
export function planImportData(
  geographicFilesFolders,
  outputFolder,
  rasterNames = new Map()
) {
  const files = {};
  const recording = {
    files,
    quiet: true,
    stage(relative, source, hash) {
      files[posix(relative)] = hash;
    },
    finish() {},
  };
  for (const folder of geographicFilesFolders) {
    copyGeographicDataForImport(folder, outputFolder, rasterNames, recording);
  }
  return files;
}

/**
 * Stages the zipped shapefiles the geographic-info-reader already produced (in
 * "<geographicFilesFolder>/output/*.zip") plus the standalone import script into
 * <outputFolder>/deploy/importer/, regardless of whether this run deploys or not.
 *
 * This lets the generated docker-compose stack load its own data the first time
 * `docker-compose up` finishes (see templates/import.js and the data-importer
 * service in mini-lps), instead of data only ever loading through a separate
 * `gispublisher --config ...` deploy run.
 *
 * Pass one `staging` (createImportStaging) shared by all the folders of a run and call
 * its `finish()` afterwards; without one this stages just this folder and finishes.
 */
export function copyGeographicDataForImport(
  geographicFilesFolder,
  outputFolder,
  rasterNames = new Map(),
  staging = null
) {
  const ownStaging = !staging;
  staging = staging || createImportStaging(outputFolder);

  const stageFolder = () => {
    const zipsFolder = path.join(geographicFilesFolder, "output");
    if (!fs.existsSync(zipsFolder)) return;

    const outputFiles = fs.readdirSync(zipsFolder);
    const zipFiles = outputFiles.filter((file) =>
      file.toLowerCase().endsWith(".zip")
    );
    // GeoTIFFs go up under the GeoServer layer name gispublisher gave them (see
    // raster-util.js), so what the importer uploads is what the client asks for.
    const tifFiles = outputFiles.filter(
      (file) =>
        /\.tiff?$/i.test(file) && rasterNames.has(file.replace(/\.[^.]+$/, ""))
    );
    if (zipFiles.length === 0 && tifFiles.length === 0) return;

    const destFolder = path.join(outputFolder, IMPORTER_DEST_RELATIVE);
    fs.mkdirSync(destFolder, { recursive: true });

    for (const file of zipFiles) {
      const source = path.join(zipsFolder, file);
      staging.stage(file, source, zipContentHash(source));
    }

    for (const file of tifFiles) {
      const layerName = rasterNames.get(file.replace(/\.[^.]+$/, ""));
      const source = path.join(zipsFolder, file);
      staging.stage(
        path.join("rasters", `${layerName}.tif`),
        source,
        fileHash(source)
      );
    }

    // .mjs (not .js): the script uses ESM `import` syntax and deploy/importer/
    // has no package.json to set "type":"module" for a plain .js file — without
    // the .mjs extension, `node import.js` throws "Cannot use import statement
    // outside a module" and docker-compose's data-importer service exits 1,
    // leaving the generated app with an empty database. mini-lps's own
    // deploy/importer/Dockerfile template COPYs/CMDs this same filename.
    fs.copyFileSync(
      path.join(__dirname, "templates", "import.mjs"),
      path.join(destFolder, "import.mjs")
    );

    if (!staging.quiet) {
      console.info(
        `Staged ${zipFiles.length} shapefile(s) and ${tifFiles.length} raster(s) for auto-import in ${staging.dataFolder}`
      );
    }
  };

  stageFolder();
  if (ownStaging) staging.finish();
}
