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

const GeoTypes = {
  TIFF: "geoTIFF",
  SHAPEFILE: "shapefile",
};

export default class GISPublisher {
  constructor(config) {
    this.config = config;
    this.GisName = this.config.name || "test";
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
      this.GisName,
      this.config.deploy.type == "local"
    );
    let allGeographicFilesInfo = [];
    for (const entryPath of directories) {
      geographicFilesInfo = await processor.processFolder(entryPath);
      const exceptGeotiff = geographicFilesInfo.filter(
        (file) => file.type != GeoTypes.TIFF
      );

      if (geographicFilesInfo.length > 0) {
        dslInstances +=
          createEntityScheme(exceptGeotiff) +
          createMapFromEntity(
            geographicFilesInfo,
            entryPath,
            path.basename(entryPath)
          );
        allGeographicFilesInfo.push(...geographicFilesInfo);
      }
    }
    dslInstances += endDSLInstance(this.GisName);

    if (DEBUG) {
      fs.writeFileSync("spec.dsl", dslInstances, "utf-8");
    }

    const json = gisdslParser(dslInstances);

    // Set custom feature selection
    if (this.config.features && this.config.features.length > 0) {
      json.features = this.config.features;
    }

    json.basicData.version = this.config.version || "1.0.0";

    //If it is a GeoTIFF, check the MV_MS_GeoServer feature
    if (this.hasInfoGeotiffFiles(allGeographicFilesInfo)) {
      json.features = [
        ...json.features,
        ...["MV_MS_GeoServer", "DM_DI_DF_GeoTIFF"].filter(
          (f) => !json.features.includes(f)
        ),
      ];
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
          allGeographicFilesInfo,
          this.config.host
        );
      }
    }
  }

  hasInfoGeotiffFiles(geographicFilesInfo) {
    for (let geographicFileInfo of geographicFilesInfo) {
      if (geographicFileInfo.type === GeoTypes.TIFF) return true;
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
