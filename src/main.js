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

import { uploadGeographicFiles } from "./geographic-files-importer.js";

const DEBUG = process.env.DEBUG;

export default class GISPublisher {
  constructor(config) {
    this.config = config;
  }

  async run(geographicFilesFolder, bbox, shouldDeploy, onlyImport) {
    if (!geographicFilesFolder.endsWith(path.sep))
      geographicFilesFolder += path.sep;

    if (onlyImport) {
      await this.iterateDirectories(
        geographicFilesFolder,
        async (entryPath) => {
          await uploadGeographicFiles(entryPath, this.config.host);
        }
      );
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

    let dslInstances = createBaseDSLInstance(
      "default",
      this.config.deploy.type == "local"
    );

    await this.iterateDirectories(
      geographicFilesFolder,
      async (entryPath, name) => {
        const geographicFilesInfo = await processor.processFolder(entryPath);
        if (geographicFilesInfo.length > 0) {
          dslInstances +=
            createEntityScheme(geographicFilesInfo) +
            createMapFromEntity(geographicFilesInfo, entryPath, name);
        }
      }
    );

    dslInstances += endDSLInstance("default");

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
      await this.iterateDirectories(
        geographicFilesFolder,
        async (entryPath) => {
          await uploadGeographicFiles(entryPath, this.config.host);
        }
      );
    }
  }

  async iterateDirectories(rootPath, callback) {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });

    // Process the root directory if it contains files
    if (entries.some((item) => item.isFile())) {
      await callback(rootPath, "default");
    }

    // Process subdirectories
    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        await callback(entryPath, entry.name);
      }
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
