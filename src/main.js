import { DerivationEngine, readJsonFromFile, readFile } from "spl-js-engine";
import {
  Uploader,
  DebianUploadStrategy,
  AWSUploadStrategy,
  LocalUploadStrategy,
} from "@lbdudc/gp-code-uploader";
// import { SearchAPIClient } from "giscatalog-client";
import Processor from "@lbdudc/gp-shapefile-reader";
import path from "path";
import {
  createEntityScheme,
  createMapFromEntity,
  createBaseDSLInstance,
  endDSLInstance,
} from "./dsl-util.js";
import gisdslParser from "@lbdudc/gp-gis-dsl";
import fs from "fs";

import { uploadShapefiles } from "./shp-importer.js";

const DEBUG = process.env.DEBUG;

export default class GISPublisher {
  constructor(config) {
    this.config = config;
  }

  async run(shapefilesFolder, bbox, shouldDeploy, onlyImport) {
    if (!shapefilesFolder.endsWith(path.sep)) shapefilesFolder += path.sep;

    if (onlyImport) {
      await uploadShapefiles(shapefilesFolder, this.config.host);
      return;
    }
    // if (DEBUG) {
    //   console.log(SearchAPIClient);
    // }

    // Create a new instance of the processor
    const processor = new Processor({
      encoding: "utf-8", // 'auto' by default || 'ascii' || 'utf8' || 'utf-8'
      geographicInfo: false, // true by default
      records: false, // true by default
    });

    // const client = new SearchAPIClient({
    //   catalogURI: 'https://demo.pygeoapi.io/master',
    // });

    // const collections = await client.search();
    // console.log(collections);

    let dslInstances = "";
    let rootFilesProcessed = false;

    // Read files in the shapefiles folder
    const entries = fs.readdirSync(shapefilesFolder, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(shapefilesFolder, entry.name);
      if (entry.isDirectory()) {
        // Process the shapefiles in the subfolder
        const shapefilesInfo = await processor.processFolder(entryPath);
        dslInstances +=
          createBaseDSLInstance(
            entry.name,
            this.config.deploy.type == "local"
          ) +
          createEntityScheme(shapefilesInfo) +
          createMapFromEntity(shapefilesInfo, entryPath) +
          endDSLInstance(entry.name);
      } else if (!rootFilesProcessed) {
        // Process the shapefiles in the root folder if not processed yet
        const shapefilesInfo = await processor.processFolder(shapefilesFolder);
        dslInstances +=
          createBaseDSLInstance("default", this.config.deploy.type == "local") +
          createEntityScheme(shapefilesInfo) +
          createMapFromEntity(shapefilesInfo, shapefilesFolder) +
          endDSLInstance("default");
        rootFilesProcessed = true;
      }
    }

    if (DEBUG) {
      fs.writeFileSync("spec.dsl", dslInstances, "utf-8");
    }

    const json = gisdslParser(dslInstances);

    // Set custom feature selection
    if (this.config.features && this.config.features.length > 0) {
      json.features = this.config.features;
    }

    fs.writeFileSync("spec.json", JSON.stringify(json, null, 2), "utf-8");

    const engine = await new DerivationEngine({
      codePath: this.config.platform.codePath,
      featureModel: readFile(this.config.platform.featureModel),
      config: readJsonFromFile(this.config.platform.config),
      extraJS: readFile(this.config.platform.extraJS),
      modelTransformation: readFile(this.config.platform.modelTransformation),
      verbose: DEBUG,
    });

    engine.generateProduct("output", readJsonFromFile("spec.json"));

    if (shouldDeploy) {
      await this.deploy();
      await uploadShapefiles(shapefilesFolder, this.config.host);
    }
  }

  async deploy() {
    const uploader = new Uploader();

    const strategies = {
      ssh: new DebianUploadStrategy(),
      aws: new AWSUploadStrategy(),
      local: new LocalUploadStrategy(),
    };

    uploader.setUploadStrategy(
      strategies[this.config.deploy.type] || strategies.local
    );

    let deployConf = this.config.deploy;

    deployConf.repoPath = "output";

    if (deployConf.type && deployConf.type.toLowerCase() == "aws") {
      const ip = await uploader.createInstance(deployConf);
      deployConf.host = ip;
    }

    // Upload and deploy code
    await uploader.uploadCode(deployConf);
  }
}
