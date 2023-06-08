import { DerivationEngine, readJsonFromFile, readFile } from "spl-js-engine";
import { Uploader, DebianUploadStrategy } from "code-uploader";
import { SearchAPIClient } from "giscatalog-client";
import Processor from "shapefile-reader";
import path from "path";
import {
  createEntityScheme,
  createBaseDSLInstance,
  endDSLInstance,
} from "./dsl-util.js";
import { upperCamelCase } from "./str-util.js";
import gisdslParser from "gisdsl";
import fs from "fs";

export default class Gisbuilder2 {
  constructor(config, debug) {
    this.config = config;
    this.debug = debug;
  }

  async run(shapefilesFolder, bbox, shouldDeploy) {
    if (!shapefilesFolder.endsWith(path.sep)) shapefilesFolder += path.sep;

    if (this.debug) {
      console.log(SearchAPIClient);
    }

    // Create a new instance of the processor
    const processor = new Processor({
      encoding: "utf-8", // 'auto' by default || 'ascii' || 'utf8' || 'utf-8'
      geographicInfo: false, // true by default
      records: false, // true by default
    });
    const shapefilesInfo = await processor.processFolder(shapefilesFolder);

    // const client = new SearchAPIClient({
    //   catalogURI: 'https://demo.pygeoapi.io/master',
    // });

    // const collections = await client.search();
    // console.log(collections);

    let dslInstance =
      createBaseDSLInstance("test") +
      createEntityScheme(shapefilesInfo) +
      endDSLInstance("test");

    if (this.debug) {
      console.log(dslInstance);
    }

    const json = gisdslParser(dslInstance);

    if (this.debug) {
      fs.writeFileSync("spec.json", JSON.stringify(json, null, 2), "utf-8");
    }

    const engine = await new DerivationEngine({
      codePath: this.config.platform.codePath,
      featureModel: readFile(this.config.platform.featureModel),
      config: readJsonFromFile(this.config.platform.config),
      extraJS: readFile(this.config.platform.extraJS),
      modelTransformation: readFile(this.config.platform.modelTransformation),
      verbose: false,
    });

    engine.generateProduct("output", json);

    if (shouldDeploy) {
      await this.deploy();
      await this.uploadShapefiles(shapefilesFolder);
    }
  }

  async deploy() {
    const uploader = new Uploader();
    uploader.setUploadStrategy(new DebianUploadStrategy());

    const config = {
      host: this.config.deploy.host,
      port: this.config.deploy.port,
      username: this.config.deploy.username,
      certRoute: this.config.deploy.certRoute,
      repoPath: "output",
      remoteRepoPath: this.config.deploy.remoteRepoPath,
    };

    // Upload and deploy code
    await uploader.uploadCode(config);
  }

  async uploadShapefiles(shapefilesFolder) {
    // Fist, we wait for the server to be running to send the Shapefiles and save them in the database
    await this._waitForServer();

    /* Secondly, we get all the entities from the server to create the mapping between
      the shapefiles' columns and the entities' attributes */
    const entities = await this._getEntities();

    /*
    Next, we do the following: we obtain the name of the entity from the name of the ZIP file that contains the shapefiles. Then, we upload that ZIP file to the server to create a temporary file and extract the attributes of the shapefile. Once all this information is obtained, we map the attributes and send a request to the server to load the data into the database.
     */
    const zipFiles = this._getShapefiles(shapefilesFolder);
    for (const zipFile of zipFiles) {
      const entity = entities.find((entity) =>
        entity.name.endsWith(this._fileNameToEntityName(zipFile))
      );
      // We upload a temporary file to the server, and we get returned the attributes
      const response = await this._uploadTempShapefile(
        shapefilesFolder,
        zipFile
      );
      await this._uploadShapefileData(
        response.temporaryFile,
        entity,
        response.values
      );
    }
  }

  async _getEntities() {
    return await fetch(`${this.config.host}/backend/api/entities`).then((res) =>
      res.json()
    );
  }

  async _uploadTempShapefile(shapefilesFolder, shapefileName) {
    const formData = new FormData();
    formData.append("type", "shapefile");
    formData.append("encoding", "utf-8");
    /*    const file = fs.readFileSync(`${shapefilesFolder.replace(/\\$/, '')}output/${shapefileName}`);
      const fileBlob = new Blob([file], { type: 'application/octet-stream' });
      formData.append("file", fileBlob);*/
    console.log(shapefilesFolder, shapefileName);
    return await fetch(`${this.config.host}/backend/api/import`, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
      },
      body: formData,
    }).then((res) => res.json());
  }

  async _waitForServer() {
    let isServerRunning = false;
    while (!isServerRunning) {
      try {
        await fetch(`${this.config.host}/backend`);
        isServerRunning = true;
      } catch (e) {
        // Waiting 5 minutes to retry
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  _getShapefiles(shapefilesFolder) {
    return fs
      .readdirSync(shapefilesFolder + "/output")
      .filter((fName) => fName.indexOf(".zip") !== -1);
  }

  async _uploadShapefileData(tmpShapefile, shapefileAttrs, entity) {
    // TODO: aquí se indica el shapefile temporal que ya está subido y el mapping de atributos
    /**
     * ESTE SERÍA EL BODY
     * {
     *    "entityName":"es.udc.lbd.gema.lps.model.domain.ValoresIndices",
     *    "encoding":"UTF-8",
     *    "file":"TMP-6434613227168661648.zip",
     *    "ncolumns":19,
     *    "skipFirstLine":true,
     *    "type":"shapefile",
     *    "url":null,
     *    "columns":[
     *       {
     *          "name":"geometria",
     *          "type":"org.locationtech.jts.geom.MultiPolygon",
     *          "simpleType":"MultiPolygon",
     *          "collection":false,
     *          "autogenerated":false,
     *          "constraints":null
     *       }
     *    ]
     * }
     */
    console.log(tmpShapefile, shapefileAttrs, entity); // TODO: remove this!
    const data = {
      file: tmpShapefile,
      type: "shapefile",
      encoding: "utf-8",
    };
    return await fetch(`${this.config.host}/backend/api/import`, {
      method: "PUT",
      body: JSON.stringify(data),
    }).then((res) => res.json());
  }

  _fileNameToEntityName(fileName) {
    return upperCamelCase(fileName.slice(0, fileName.length - 4));
  }
}
