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
import gisdslParser from "gis-dsl";
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
      this.deploy();
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
}
