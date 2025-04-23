import fs from "fs";
import path from "path";
import { lowerCamelCase, upperCamelCase } from "./str-util.js";
import { waitForServer } from "./waitForServer.js";
import { Blob } from "buffer";
import mime from "mime";

const DEBUG = process.env.DEBUG;

const GeoTypes = {
  TIFF: "geoTIFF",
  SHAPEFILE: "shapefile",
};

export async function uploadGeographicFiles(
  geographicFilesFolder,
  geographicFilesInfo,
  host
) {
  console.info("Starting the import of geographic files");

  // Fist, we wait for the server to be running to send the geographicFiles
  await waitForServer(host);

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
  const geographicFiles = _getGeographicFiles(
    geographicFilesFolder,
    geographicFilesInfo
  );
  if (DEBUG) {
    console.log(geographicFiles);
  }
  for (const geographicFile of geographicFiles) {
    await new Promise((r) => setTimeout(r, 15000));
    const entity = entities.find((entity) =>
      entity.name.endsWith(_fileNameToEntityName(geographicFile))
    );

    let fileType = obtainFileType(geographicFilesInfo, geographicFile);

    if (fileType == GeoTypes.SHAPEFILE) {
      // We upload a temporary file to the server, and we get returned the attributes
      const response = await _uploadTempGeographicFileShapefile(
        host,
        geographicFilesFolder,
        geographicFile
      );
      console.info(
        `Uploading data to the entity ${entity.name} from ${geographicFile}`
      );
      await _uploadGeographicFileDataShapefile(
        host,
        response.temporaryFile,
        response.values,
        entity
      );
    } else if (fileType == GeoTypes.TIFF) {
      console.info(`Uploading geotiff ${geographicFile}`);
      await _handleGeographicFileGeotiff(
        host,
        geographicFile,
        geographicFilesFolder
      );
    }

    if (entity) {
      await _restartBBox(host, entity);
    }
  }
  console.info("The import of geographic files has finished");
}

function obtainFileType(geographicFilesInfo, fileName) {
  const fileInfo = geographicFilesInfo.find(
    (info) => info.fileName == fileName
  );
  return fileInfo?.type;
}

async function _getEntities(host) {
  if (DEBUG) {
    console.log(`${host}/backend/api/entities`);
  }
  return await fetch(`${host}/backend/api/entities`).then((res) => res.json());
}

async function _uploadTempGeographicFileShapefile(
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
  const fileBuffer = await fs.promises.readFile(
    `${geographicFilesFolder.replace(/\\$/, "")}${path.sep}output${
      path.sep
    }${geographicFileName}`
  );
  const mimeType = mime.getType(geographicFileName) || undefined;
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append("file", blob, geographicFileName);
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
    console.error(`Error uploading geographic file ${geographicFileName}`, err);
    throw err;
  }
}

function _getGeographicFiles(geographicFilesFolder, geographicFilesInfo) {
  const outputFolder = `${geographicFilesFolder}/output`;

  const FileExtension = {
    ZIP: "zip",
    TIF: "tif",
  };

  return fs
    .readdirSync(outputFolder)
    .filter(
      (fName) =>
        (fName.endsWith(FileExtension.ZIP) ||
          fName.endsWith(FileExtension.TIF)) &&
        fName !== FileExtension.ZIP &&
        fName !== FileExtension.TIF
    )
    .filter((fName) =>
      geographicFilesInfo.some(
        (info) =>
          info.fileName === fName &&
          (info.type === GeoTypes.SHAPEFILE || info.type === GeoTypes.TIFF)
      )
    );
}

async function _uploadGeographicFileDataShapefile(
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

async function _handleGeographicFileGeotiff(
  host,
  fName,
  geographicFilesFolder
) {
  await waitForServer(host);
  const filePath = path.join(geographicFilesFolder, fName);
  const fileBuffer = await fs.promises.readFile(filePath);
  const blob = new Blob([fileBuffer]);

  const form = new FormData();
  form.set("file", blob, fName);
  try {
    await fetch(`${host}/backend/api/import/layer`, {
      method: "POST",
      body: form,
    });
  } catch (err) {
    console.error(`Fetch failed for ${fName}:`, err);
  }
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
