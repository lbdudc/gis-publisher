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
import fs from "fs";
import path from "path";

const SERVER_HOST = process.env.SERVER_HOST || "http://server:9001";
const DATA_DIR = path.join(process.cwd(), "data");
const RASTER_DIR = path.join(DATA_DIR, "rasters");

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
 * containers (it is a volume): without this check every `docker compose up` that restarts
 * it loads all the shapefiles again, and each layer ends up with its features duplicated.
 * An entity that already has rows is left as it is; to load a new version of the data,
 * start from an empty database (`docker compose down -v`).
 */
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

  for (const fileName of zipFiles) {
    const entity = entities.find((e) =>
      e.name.endsWith(fileNameToEntityName(fileName))
    );
    if (!entity) {
      console.warn(`[import] No entity matches "${fileName}", skipping.`);
      continue;
    }
    if (await hasData(entity)) {
      console.info(
        `[import] ${entity.name} already has data, skipping ${fileName}.`
      );
      continue;
    }
    try {
      console.info(`[import] Uploading ${fileName} -> ${entity.name}...`);
      const { temporaryFile, values } = await uploadTempShapefile(
        path.join(DATA_DIR, fileName),
        fileName
      );
      await importShapefileData(temporaryFile, values, entity);
      await restartBBox(entity);
      console.info(`[import] ${fileName} imported into ${entity.name}.`);
    } catch (e) {
      console.error(`[import] Failed to import ${fileName}: ${e.message}`);
    }
  }

  for (const fileName of rasterFiles) {
    try {
      console.info(`[import] Uploading raster ${fileName}...`);
      await uploadRaster(fileName);
      console.info(`[import] Raster ${fileName} imported.`);
    } catch (e) {
      console.error(`[import] Failed to import ${fileName}: ${e.message}`);
    }
  }

  console.info("[import] Done.");
}

main().catch((e) => {
  console.error("[import] Fatal error:", e);
  process.exit(1);
});
