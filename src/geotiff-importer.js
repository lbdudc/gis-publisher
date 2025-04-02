import fs from "fs";
import path from "path";
import { _waitForServer } from "./waitForServer.js";

export async function geotiffImporter(
  geographicFilesFolder,
  geographicFilesInfo,
  host
) {
  // Fist, we wait for the server to be running to send the geographicFiles
  await _waitForServer(host);

  console.info("Starting the import of geotiff geographic files");

  const files = _getGeotiffFiles(geographicFilesFolder, geographicFilesInfo);

  if (files.length === 0) {
    console.warn("No matching geotiff files found.");
    return;
  }
  for (const fName of files) {
    const filePath = path.join(geographicFilesFolder, fName);
    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer]);

    const form = new FormData();
    form.set("file", blob, fName);
    const headers =
      typeof form.getHeaders === "function"
        ? form.getHeaders()
        : { "Content-Type": "multipart/form-data" };
    try {
      await fetch(`${host}/backend/api/import/layer`, {
        method: "POST",
        body: form,
        headers: headers,
      });
    } catch (err) {
      console.error(`Fetch failed for ${fName}:`, err);
    }
  }
  console.info("The import of geotiff geographic files has finished");
}

function _getGeotiffFiles(geographicFilesFolder, geographicFilesInfo) {
  const outputFolder = `${geographicFilesFolder}/output`;

  return fs
    .readdirSync(outputFolder)
    .filter(
      (fName) =>
        (fName.endsWith(".zip") || fName.endsWith(".tif")) &&
        fName !== ".zip" &&
        fName !== ".tif"
    )
    .filter((fName) =>
      geographicFilesInfo.some(
        (file) => file.fileName === fName && file.type === "geoTIFF"
      )
    );
}
