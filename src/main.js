import { DerivationEngine, readJsonFromFile, readFile } from "spl-js-engine";
import {
  Uploader,
  DebianUploadStrategy,
  AWSUploadStrategy,
  LocalUploadStrategy,
} from "@lbdudc/gp-code-uploader";
// import { SearchAPIClient } from "giscatalog-client";
import Processor from "@lbdudc/gp-geographic-info-reader";
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

    const directories = this.getDirectories(geographicFilesFolder);
    // Create a new instance of the processor
    const processor = new Processor({
      encoding: "utf-8", // 'auto' by default || 'ascii' || 'utf8' || 'utf-8'
      geographicInfo: false, // true by default
      records: false, // true by default
    });

    let geographicFilesInfo = [];

    if (onlyImport) {
      for (const entryPath of directories) {
        geographicFilesInfo = await processor.processFolder(entryPath);

        await uploadGeographicFiles(
          entryPath,
          geographicFilesInfo,
          this.config.host
        );
      }
      return;
    }
    // if (DEBUG) {
    //   console.log(SearchAPIClient);
    // }

    // const client = new SearchAPIClient({
    //   catalogURI: 'https://demo.pygeoapi.io/master',
    // });

    // const collections = await client.search();
    // console.log(collections);

    let dslInstances = createBaseDSLInstance(
      "prueba1",
      this.config.deploy.type == "local"
    );

    for (const entryPath of directories) {
      geographicFilesInfo = await processor.processFolder(entryPath);
      const exceptGeotiff = geographicFilesInfo.filter(
        (file) => file.type != "geoTIFF"
      );

      if (geographicFilesInfo.length > 0) {
        dslInstances +=
          createEntityScheme(exceptGeotiff) +
          createMapFromEntity(
            geographicFilesInfo,
            entryPath,
            path.basename(entryPath)
          );
      }
    }
    dslInstances += endDSLInstance("prueba1");

    console.log(dslInstances);
    if (DEBUG) {
      fs.writeFileSync("spec.dsl", dslInstances, "utf-8");
    }

    const json = gisdslParser(dslInstances);

    // Set custom feature selection
    if (this.config.features && this.config.features.length > 0) {
      json.features = this.config.features;
    }

    json.basicData.version = this.config.version || "1.0.0";

    //Si es geotiff comprobar feature MV_MS_GeoServer
    if (this.hasInfoGeotiffFiles(geographicFilesInfo)) {
      const hasGeoTIFFFeature = json.features.includes("DM_DI_DF_GeoTIFF");
      const hasGeoServerFeature = json.features.includes("MV_MS_GeoServer");
      if (!hasGeoServerFeature) {
        json.features.push("MV_MS_GeoServer");
      }
      if (!hasGeoTIFFFeature) {
        json.features.push("DM_DI_DF_GeoTIFF");
      }
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
      for (const entryPath of directories) {
        await uploadGeographicFiles(
          entryPath,
          geographicFilesInfo,
          this.config.host
        );
      }
    }
  }

  hasInfoGeotiffFiles(geographicFilesInfo) {
    for (let geographicFileInfo of geographicFilesInfo) {
      if (geographicFileInfo.type === "geoTIFF") return true;
    }
    return false;
  }

  getDirectories(rootPath) {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    let directories = [];

    // Include root directory if it contains files
    if (entries.some((entry) => entry.isFile())) {
      directories.push(rootPath);
    }

    // Include subdirectories (excluding "output")
    directories.push(
      ...entries
        .filter((entry) => entry.isDirectory() && entry.name !== "output")
        .map((entry) => path.join(rootPath, entry.name))
    );

    return directories;
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
