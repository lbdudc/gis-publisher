import fs from "fs";
import path from "path";
import { Blob, File } from "buffer";
import { lowerCamelCase, upperCamelCase } from "./str-util.js";

const DEBUG = process.env.DEBUG;

export async function uploadShapefiles(shapefilesFolder, host) {
  console.info("Starting the import of shapefiles");

  // Fist, we wait for the server to be running to send the shapefiles
  await _waitForServer(host);

  /* Secondly, we get all the entities from the server to create the mapping between
    the shapefiles' columns and the entities' attributes */
  const entities = await _getEntities(host);
  if (DEBUG) {
    console.log(entities);
  }

  /*
  Next, we do the following: we obtain the name of the entity from the name of the ZIP file
    that contains the shapefiles. Then, we upload that ZIP file to the server to create
    a temporary file and extract the attributes of the shapefile.
    Once all this information is obtained, we map the attributes and send a request
    to the server to load the data into the database.
   */
  if (DEBUG) {
    console.log(shapefilesFolder);
  }
  const zipFiles = _getShapefiles(shapefilesFolder);
  if (DEBUG) {
    console.log(zipFiles);
  }
  for (const zipFile of zipFiles) {
    await new Promise((r) => setTimeout(r, 15000));
    const entity = entities.find((entity) =>
      entity.name.endsWith(_fileNameToEntityName(zipFile))
    );
    // We upload a temporary file to the server, and we get returned the attributes
    const response = await _uploadTempShapefile(
      host,
      shapefilesFolder,
      zipFile
    );
    console.info(`Uploading data to the entity ${entity.name} from ${zipFile}`);
    await _uploadShapefileData(
      host,
      response.temporaryFile,
      response.values,
      entity
    );
    await _restartBBox(host, entity);
  }
  console.info("The import of Shapefiles has finished");
}

async function _getEntities(host) {
  if (DEBUG) {
    console.log(`${host}/backend/api/entities`);
  }
  return await fetch(`${host}/backend/api/entities`).then((res) => res.json());
}

async function _uploadTempShapefile(host, shapefilesFolder, shapefileName) {
  const formData = new FormData();
  formData.append("type", "shapefile");
  formData.append("encoding", "utf-8");
  if (DEBUG) {
    console.log(
      `${shapefilesFolder.replace(/\\$/, "")}${path.sep}output${
        path.sep
      }${shapefileName}`
    );
  }
  const file = fs.readFileSync(
    `${shapefilesFolder.replace(/\\$/, "")}${path.sep}output${
      path.sep
    }${shapefileName}`
  );
  const fileObj = new File([new Blob([file])], shapefileName, {
    type: "application/x-zip-compressed",
  });
  formData.append("file", fileObj);
  try {
    const response = await fetch(`${host}/backend/api/import`, {
      method: "POST",
      body: formData,
    });
    if (DEBUG) {
      console.log(response);
    }
    return await response.json();
  } catch (err) {
    console.error(`Error uploading shapefile ${shapefileName}`, err);
    throw err;
  }
}

async function _waitForServer(host) {
  let isServerRunning = false;
  while (!isServerRunning) {
    try {
      const response = await fetch(`${host}/backend`);
      if (response.status != 502) {
        isServerRunning = true;
      } else {
        console.info("Server not available. Retrying connection...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    } catch (e) {
      console.info("Server not available. Retrying connection...");
      // Waiting 5 seconds to retry
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function _getShapefiles(shapefilesFolder) {
  return fs
    .readdirSync(shapefilesFolder + "/output")
    .filter((fName) => fName.indexOf(".zip") !== -1)
    .filter((fName) => fName != ".zip");
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
  if (DEBUG) {
    console.log(data);
  }
  return await fetch(`${host}/backend/api/import`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  }).catch((err) =>
    console.error(`Error inserting data into entity ${entity.name}`, err)
  );
}

async function _restartBBox(host, entity) {
  // Before making the request we get the name of the entity and convert it to camelCase format with the first letter being lowercase
  const entityNameParts = entity.name.split(".");
  let entityName = entityNameParts[entityNameParts.length - 1];
  entityName = entityName.replace(/^./, entityName[0].toLowerCase());
  return await fetch(
    `${host}/backend/api/entities/${entityName}s/geom/restart`,
    {
      method: "PUT",
    }
  );
}

function _fileNameToEntityName(fileName) {
  return upperCamelCase(fileName.slice(0, fileName.length - 4));
}
