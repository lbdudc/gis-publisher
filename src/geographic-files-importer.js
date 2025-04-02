import fs from "fs";
import path from "path";
import { lowerCamelCase, upperCamelCase } from "./str-util.js";
import mime from "mime";
import { _waitForServer } from "./waitForServer.js";
import { Blob, File } from "buffer";

const DEBUG = process.env.DEBUG;

export async function uploadGeographicFiles(
  geographicFilesFolder,
  geographicFilesInfo,
  host
) {
  console.info("Starting the import of geographic files");

  // Fist, we wait for the server to be running to send the geographicFiles
  await _waitForServer(host);

  /* Secondly, we get all the entities from the server to create the mapping between
    the geographic files' columns and the entities' attributes */
  const entities = await _getEntities(host);
  if (DEBUG) {
    console.log(entities);
  }

  /*
  Next, we do the following: we obtain the name of the entity from the name of the geographic file.
    Then, we upload that file to the server to create
    a temporary file and extract the attributes.
    Once all this information is obtained, we map the attributes and send a request
    to the server to load the data into the database.
   */
  if (DEBUG) {
    console.log(geographicFilesFolder);
  }
  const zipFiles = _getGeographicFiles(
    geographicFilesFolder,
    geographicFilesInfo
  );
  if (DEBUG) {
    console.log(zipFiles);
  }
  for (const zipFile of zipFiles) {
    await new Promise((r) => setTimeout(r, 15000));
    const entity = entities.find((entity) =>
      entity.name.endsWith(_fileNameToEntityName(zipFile))
    );
    // We upload a temporary file to the server, and we get returned the attributes
    const response = await _uploadTempGeographicFile(
      host,
      geographicFilesFolder,
      zipFile
    );
    console.info(`Uploading data to the entity ${entity.name} from ${zipFile}`);
    await _uploadGeographicFileData(
      host,
      response.temporaryFile,
      response.values,
      entity
    );
    await _restartBBox(host, entity);
  }
  console.info("The import of geographic files has finished");
}

async function _getEntities(host) {
  if (DEBUG) {
    console.log(`${host}/backend/api/entities`);
  }
  return await fetch(`${host}/backend/api/entities`).then((res) => res.json());
}

async function _uploadTempGeographicFile(
  host,
  geographicFilesFolder,
  geographicFileName
) {
  const EXTENSION_FILE_TYPE_MAPPING = {
    ".zip": "shapefile",
    ".gpkg": "geoPackage",
  };

  const extension = path.extname(geographicFileName).toLowerCase();
  const fileType = EXTENSION_FILE_TYPE_MAPPING[extension];

  const formData = new FormData();
  formData.append("type", fileType);
  formData.append("encoding", "utf-8");
  if (DEBUG) {
    console.log(
      `${geographicFilesFolder.replace(/\\$/, "")}${path.sep}output${
        path.sep
      }${geographicFileName}`
    );
  }
  const file = fs.readFileSync(
    `${geographicFilesFolder.replace(/\\$/, "")}${path.sep}output${
      path.sep
    }${geographicFileName}`
  );
  const fileObj = new File([new Blob([file])], geographicFileName, {
    type: mime.getType(geographicFileName),
  });
  formData.append("file", fileObj);
  try {
    const response = await fetch(`${host}/backend/api/import`, {
      method: "POST",
      body: formData,
    });

    console.log("aquiiiiiiiiiiiiiiiiii");
    console.log(response);
    return await response.json();
  } catch (err) {
    console.error(`Error uploading geographic file ${geographicFileName}`, err);
    throw err;
  }
}

function _getGeographicFiles(geographicFilesFolder, geographicFilesInfo) {
  return fs
    .readdirSync(geographicFilesFolder + "/output")
    .filter((fName) => fName.indexOf(".zip") !== -1)
    .filter((fName) => fName != ".zip")
    .filter((fName) =>
      geographicFilesInfo.some(
        (info) => info.fileName === fName && info.type === "shapefile"
      )
    );
}

async function _uploadGeographicFileData(
  host,
  tmpGeographicFile,
  geographicFileAttrs,
  entity
) {
  const data = {
    columns: geographicFileAttrs.map((attr) => {
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
    file: tmpGeographicFile,
    ncolumns: geographicFileAttrs.length,
    type: "geographicFile",
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
