import fs from "fs";
import { Blob, File } from "buffer";
import { lowerCamelCase, upperCamelCase } from "./str-util.js";

export async function uploadShapefiles(shapefilesFolder, host) {
  // Fist, we wait for the server to be running to send the shapefiles
  await _waitForServer(host);

  /* Secondly, we get all the entities from the server to create the mapping between
    the shapefiles' columns and the entities' attributes */
  const entities = await _getEntities(host);

  /*
  Next, we do the following: we obtain the name of the entity from the name of the ZIP file
    that contains the shapefiles. Then, we upload that ZIP file to the server to create
    a temporary file and extract the attributes of the shapefile.
    Once all this information is obtained, we map the attributes and send a request
    to the server to load the data into the database.
   */
  const zipFiles = _getShapefiles(shapefilesFolder);
  for (const zipFile of zipFiles) {
    const entity = entities.find((entity) =>
      entity.name.endsWith(_fileNameToEntityName(zipFile))
    );
    // We upload a temporary file to the server, and we get returned the attributes
    const response = await _uploadTempShapefile(
      host,
      shapefilesFolder,
      zipFile
    );
    await _uploadShapefileData(
      host,
      response.temporaryFile,
      response.values,
      entity
    );
  }
}

async function _getEntities() {
  return await fetch(`http://localhost:8080/api/entities`).then((res) =>
    res.json()
  );
}

async function _uploadTempShapefile(host, shapefilesFolder, shapefileName) {
  const formData = new FormData();
  formData.append("type", "shapefile");
  formData.append("encoding", "utf-8");
  const file = fs.readFileSync(
    `${shapefilesFolder.replace(/\\$/, "")}output/${shapefileName}`
  );
  const fileObj = new File([new Blob([file])], shapefileName, {
    type: "application/x-zip-compressed",
  });
  formData.append("file", fileObj);
  return await fetch(`${host}/api/import`, {
    method: "POST",
    body: formData,
  })
    .then((res) => res.json())
    .catch((err) =>
      console.error(`Error uploading shapefile ${shapefileName}`, err)
    );
}

async function _waitForServer(host) {
  let isServerRunning = false;
  while (!isServerRunning) {
    try {
      await fetch(`${host}`);
      isServerRunning = true;
    } catch (e) {
      // Waiting 5 minutes to retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function _getShapefiles(shapefilesFolder) {
  return fs
    .readdirSync(shapefilesFolder + "/output")
    .filter((fName) => fName.indexOf(".zip") !== -1);
}

async function _uploadShapefileData(
  host,
  tmpShapefile,
  shapefileAttrs,
  entity
) {
  const data = {
    columns: shapefileAttrs.map((attr) => {
      // The geometry has always the name "Geometry" in the DB
      if (attr.toLowerCase().indexOf("geom") !== -1) {
        return entity.properties.find(
          (prop) => prop.name.toLowerCase() === "geometry"
        );
      }
      return entity.properties.find(
        (prop) => prop.name === lowerCamelCase(attr)
      );
    }),
    encoding: "utf-8",
    entityName: entity.name,
    file: tmpShapefile,
    ncolumns: shapefileAttrs.length,
    type: "shapefile",
  };
  return await fetch(`${host}/api/import`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }).catch((err) =>
    console.error(`Error inserting data into entity ${entity.name}`, err)
  );
}

function _fileNameToEntityName(fileName) {
  return upperCamelCase(fileName.slice(0, fileName.length - 4));
}
