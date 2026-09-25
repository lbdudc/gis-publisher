// Standalone one-shot data importer, staged into every generated product that has
// at least one shapefile entity (see copyGeographicDataForImport in
// ../import-util.js). Runs as its own docker-compose service once `server` reports
// healthy, uploading every zipped shapefile placed in ./data at generation time
// using the same import protocol geographic-files-importer.js uses for an explicit
// `gispublisher --config ...` deploy — so an app already has its data the first
// time `docker-compose up` finishes, without requiring that separate deploy run.
//
// Kept dependency-free (no npm install at build time): only Node's built-in
// fetch/FormData/Blob, available since Node 18.
import crypto from "crypto";
import fs from "fs";
import path from "path";

const SERVER_HOST = process.env.SERVER_HOST || "http://server:9001";
// Only set when the stack runs its own GeoServer: lets a raster that is already published
// be told apart from one that has to be uploaded again.
const GEOSERVER_URL = process.env.GEOSERVER_URL || "";
const DATA_DIR = path.join(process.cwd(), "data");
const RASTER_DIR = path.join(DATA_DIR, "rasters");
// Named volume kept next to the database's: which version of each file was loaded.
const STATE_FILE = path.join(process.env.STATE_DIR || "/state", "imported.json");

function lowerCamelCase(str) {
  const camelCased = str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase());
  return /^[0-9]/.test(camelCased) ? `n${camelCased}` : camelCased;
}

function upperCamelCase(str) {
  if (str.startsWith(0)) {
    str = str.slice(3);
  }
  return lowerCamelCase(str).replace(/^[a-z]/, (m) => m.toUpperCase());
}

function fileNameToEntityName(fileName) {
  return upperCamelCase(fileName.slice(0, fileName.length - 4));
}

async function waitForEntities(retries = 12, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${SERVER_HOST}/api/entities`);
      if (res.ok) return await res.json();
      console.warn(
        `[import] /api/entities returned ${res.status}, retrying...`
      );
    } catch (e) {
      console.warn(
        `[import] server not reachable yet (${e.message}), retrying...`
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Server never became reachable at ${SERVER_HOST}`);
}

async function uploadTempShapefile(zipPath, fileName) {
  const formData = new FormData();
  formData.append("type", "shapefile");
  formData.append("encoding", "utf-8");
  const buffer = await fs.promises.readFile(zipPath);
  formData.append("file", new Blob([buffer]), fileName);

  const response = await fetch(`${SERVER_HOST}/api/import`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`upload failed with status ${response.status}`);
  }
  return await response.json();
}

async function importShapefileData(temporaryFile, values, entity) {
  const data = {
    columns: values.map((attr) => {
      if (attr.toLowerCase().includes("geom")) {
        return entity.properties.find(
          (p) => p.name.toLowerCase() === "geometry"
        );
      }
      return entity.properties.find((p) => p.name === lowerCamelCase(attr));
    }),
    encoding: "utf-8",
    entityName: entity.name,
    file: temporaryFile,
    ncolumns: values.length,
    type: "shapefile",
    // The layer's rows are replaced, not added to (it may have been loaded before)
    replace: true,
  };

  const response = await fetch(`${SERVER_HOST}/api/import`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`import failed with status ${response.status}`);
  }
}

async function restartBBox(entity) {
  const parts = entity.name.split(".");
  let entityName = parts[parts.length - 1];
  entityName = entityName.replace(/^./, (c) => c.toLowerCase());
  await fetch(`${SERVER_HOST}/api/entities/${entityName}s/geom/restart`, {
    method: "PUT",
  });
}

/*
 * A GeoTIFF is uploaded under the GeoServer layer name in its file name (already
 * chosen by gispublisher, and the one the generated client asks GeoServer for).
 * The server may still be starting GeoServer up when it starts answering, so a
 * failed upload is retried.
 */
async function uploadRaster(fileName, retries = 6, delayMs = 10000) {
  const layerName = fileName.replace(/\.[^.]+$/, "");
  const buffer = await fs.promises.readFile(path.join(RASTER_DIR, fileName));

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const formData = new FormData();
      formData.append("name", layerName);
      formData.append("file", new Blob([buffer]), fileName);

      const response = await fetch(`${SERVER_HOST}/api/import/layer`, {
        method: "POST",
        body: formData,
      });
      if (response.ok) return;
      console.warn(
        `[import] raster upload returned ${response.status} (attempt ${attempt}/${retries})`
      );
    } catch (e) {
      console.warn(
        `[import] raster upload failed (${e.message}) (attempt ${attempt}/${retries})`
      );
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`upload failed after ${retries} attempts`);
}

/*
 * The importer runs every time its container starts, and the database outlives the
 * containers (it is a volume). What was loaded is remembered by content hash in STATE_FILE
 * (gispublisher writes each file's hash to data/manifest.json), so a restart or a redeploy
 * only loads the layers whose data changed, and a changed layer replaces its rows
 * (`replace`) instead of adding its features a second time. A volume from before this
 * existed has no state: everything is loaded once, replacing.
 * To start from an empty database: `docker compose down -v`.
 */
function readManifest() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf-8")
    ).files;
  } catch (e) {
    return {};
  }
}

function hashOf(manifest, key, filePath) {
  // No manifest (data staged by an older gispublisher): hash the file itself
  return (
    manifest[key] ||
    "f1:" +
      crypto
        .createHash("sha256")
        .update(fs.readFileSync(filePath))
        .digest("hex")
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")).files || {};
  } catch (e) {
    return {};
  }
}

function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ files: state }), "utf-8");
  } catch (e) {
    // Without state the next run just loads everything again
    console.warn(`[import] Could not save the import state: ${e.message}`);
  }
}

async function hasData(entity) {
  const parts = entity.name.split(".");
  const segment = parts[parts.length - 1].replace(/^./, (c) => c.toLowerCase());
  try {
    const res = await fetch(
      `${SERVER_HOST}/api/entities/${segment}s?page=0&size=1`
    );
    if (!res.ok) return false;
    const page = await res.json();
    return (page.totalElements || 0) > 0;
  } catch (e) {
    return false;
  }
}

/* Whether GeoServer already publishes the layer (its capabilities list "<workspace>:<layer>"). */
async function rasterPublished(layerName) {
  if (!GEOSERVER_URL) return false;
  try {
    const res = await fetch(
      `${GEOSERVER_URL}/ows?service=WMS&version=1.3.0&request=GetCapabilities`,
      { signal: AbortSignal.timeout(15000) }
    );
    if (!res.ok) return false;
    return (await res.text()).includes(`:${layerName}</Name>`);
  } catch (e) {
    return false;
  }
}

async function importShapefiles(zipFiles, entities, manifest, state) {
  for (const fileName of zipFiles) {
    const entity = entities.find((e) =>
      e.name.endsWith(fileNameToEntityName(fileName))
    );
    if (!entity) {
      console.warn(`[import] No entity matches "${fileName}", skipping.`);
      continue;
    }
    const hash = hashOf(manifest, fileName, path.join(DATA_DIR, fileName));
    if (state[fileName] === hash && (await hasData(entity))) {
      console.info(
        `[import] ${fileName} is unchanged and ${entity.name} already has its data, skipping.`
      );
      continue;
    }
    try {
      console.info(`[import] Uploading ${fileName} -> ${entity.name}...`);
      // A failed import leaves partial rows: never remember it as loaded
      delete state[fileName];
      writeState(state);
      const { temporaryFile, values } = await uploadTempShapefile(
        path.join(DATA_DIR, fileName),
        fileName
      );
      await importShapefileData(temporaryFile, values, entity);
      await restartBBox(entity);
      state[fileName] = hash;
      writeState(state);
      console.info(`[import] ${fileName} imported into ${entity.name}.`);
    } catch (e) {
      console.error(`[import] Failed to import ${fileName}: ${e.message}`);
    }
  }
}

async function importRasters(rasterFiles, manifest, state) {
  for (const fileName of rasterFiles) {
    const key = `rasters/${fileName}`;
    const hash = hashOf(manifest, key, path.join(RASTER_DIR, fileName));
    const layerName = fileName.replace(/\.[^.]+$/, "");
    if (state[key] === hash && (await rasterPublished(layerName))) {
      console.info(`[import] Raster ${fileName} is unchanged, skipping.`);
      continue;
    }
    try {
      console.info(`[import] Uploading raster ${fileName}...`);
      await uploadRaster(fileName);
      state[key] = hash;
      writeState(state);
      console.info(`[import] Raster ${fileName} imported.`);
    } catch (e) {
      console.error(`[import] Failed to import ${fileName}: ${e.message}`);
    }
  }
}

async function main() {
  if (!fs.existsSync(DATA_DIR)) {
    console.info("[import] No data folder found, nothing to import.");
    return;
  }
  const zipFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().endsWith(".zip"));
  const rasterFiles = fs.existsSync(RASTER_DIR)
    ? fs.readdirSync(RASTER_DIR).filter((f) => /\.tiff?$/i.test(f))
    : [];

  if (zipFiles.length === 0 && rasterFiles.length === 0) {
    console.info("[import] Nothing staged for import.");
    return;
  }

  console.info(`[import] Waiting for ${SERVER_HOST} to accept requests...`);
  const entities = await waitForEntities();

  const manifest = readManifest();
  const state = readState();

  // Shapefiles go to the database and rasters to GeoServer: they don't compete
  await Promise.all([
    importShapefiles(zipFiles, entities, manifest, state),
    importRasters(rasterFiles, manifest, state),
  ]);

  console.info("[import] Done.");
}

main().catch((e) => {
  console.error("[import] Fatal error:", e);
  process.exit(1);
});
