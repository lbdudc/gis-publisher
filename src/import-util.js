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
  outputFolder
) {
  const zipsFolder = path.join(geographicFilesFolder, "output");
  if (!fs.existsSync(zipsFolder)) return;

  const zipFiles = fs
    .readdirSync(zipsFolder)
    .filter((file) => file.toLowerCase().endsWith(".zip"));
  if (zipFiles.length === 0) return;

  const destFolder = path.join(outputFolder, IMPORTER_DEST_RELATIVE);
  const dataFolder = path.join(destFolder, "data");
  fs.mkdirSync(dataFolder, { recursive: true });

  for (const file of zipFiles) {
    fs.copyFileSync(path.join(zipsFolder, file), path.join(dataFolder, file));
  }

  fs.copyFileSync(
    path.join(__dirname, "templates", "import.js"),
    path.join(destFolder, "import.js")
  );

  console.info(
    `Staged ${zipFiles.length} shapefile(s) for auto-import in ${dataFolder}`
  );
}
