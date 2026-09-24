import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMPORTER_DEST_RELATIVE = path.join("deploy", "importer");

/**
 * Copies the zipped shapefiles the geographic-info-reader already produced (in
 * "<geographicFilesFolder>/output/*.zip") plus the standalone import script into
 * <outputFolder>/deploy/importer/, regardless of whether this run deploys or not.
 *
 * This lets the generated docker-compose stack load its own data the first time
 * `docker-compose up` finishes (see templates/import.js and the data-importer
 * service in mini-lps), instead of data only ever loading through a separate
 * `gispublisher --config ...` deploy run.
 */
export function copyGeographicDataForImport(
  geographicFilesFolder,
  outputFolder,
  rasterNames = new Map()
) {
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
  const dataFolder = path.join(destFolder, "data");
  fs.mkdirSync(dataFolder, { recursive: true });

  for (const file of zipFiles) {
    fs.copyFileSync(path.join(zipsFolder, file), path.join(dataFolder, file));
  }

  if (tifFiles.length > 0) {
    const rastersFolder = path.join(dataFolder, "rasters");
    fs.mkdirSync(rastersFolder, { recursive: true });
    for (const file of tifFiles) {
      const layerName = rasterNames.get(file.replace(/\.[^.]+$/, ""));
      fs.copyFileSync(
        path.join(zipsFolder, file),
        path.join(rastersFolder, `${layerName}.tif`)
      );
    }
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

  console.info(
    `Staged ${zipFiles.length} shapefile(s) and ${tifFiles.length} raster(s) for auto-import in ${dataFolder}`
  );
}
