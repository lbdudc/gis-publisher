import { DerivationEngine } from "spl-js-engine";
import { Uploader, BasicSSHUploadStrategy } from "code-uploader";
import Processor from "shapefile-reader";
import path from "path";
import {
  createEntityScheme,
  createBaseDSLInstance,
  endDSLInstance,
} from "./dsl-util.js";
import gisdslParser from "gisdsl";

export default class Gisbuilder2 {
  constructor(folder, bbox) {
    if (!folder.endsWith(path.sep)) folder += path.sep;
    this.shapefilesFolder = folder;
    this.bbox = bbox;
  }

  async run() {
    console.log(DerivationEngine);
    console.log(Uploader);
    console.log(BasicSSHUploadStrategy);
    console.log(Processor);

    // Create a new instance of the processor
    const processor = new Processor({
      encoding: "utf-8", // 'auto' by default || 'ascii' || 'utf8' || 'utf-8'
      geographicInfo: false, // true by default
      records: false, // true by default
    });
    const res = await processor.getSHPFolderInfo(this.shapefilesFolder);

    let dslInstance =
      createBaseDSLInstance("test") +
      createEntityScheme(res) +
      endDSLInstance("test");
    console.log(dslInstance);
    const json = gisdslParser(dslInstance);
    console.log(json);
  }
}
