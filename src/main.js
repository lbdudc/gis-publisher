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
  createLayerDeclarations,
  createMapBlock,
  createBaseDSLInstance,
  createBaseTileLayer,
  endDSLInstance,
} from "./dsl-util.js";
import gisdslParser from "@lbdudc/gp-gis-dsl";
import fs from "fs";
import { getChartsFromJson } from "./chart-util.js";
import { copyModelFiles, getModelsFromFolder } from "./model-util.js";
import { copyGeographicDataForImport } from "./import-util.js";
import { assignRasterNames, rasterLayerName } from "./raster-util.js";
import { readTileSidecars } from "./tile-util.js";
import { scopeWmsLayers } from "./wms-util.js";
import {
  readProjectManifest,
  applyManifestToMaps,
  resolveMapTitle,
  processingCrsFromManifest,
} from "./manifest-util.js";

import { uploadGeographicFiles } from "./geographic-files-importer.js";
import { createReporter } from "./progress.js";

import { fileURLToPath } from "url";

const DEBUG = process.env.DEBUG;

const GeoTypes = {
  TIFF: "geoTIFF",
  SHAPEFILE: "shapefile",
  WMS: "wms",
  XYZ: "xyz",
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_ROOT = path.resolve(__dirname, "..");

function resolveFromCliRoot(p) {
  if (!p) return p;
  return path.isAbsolute(p) ? p : path.join(CLI_ROOT, p);
}

export default class GISPublisher {
  constructor(config, { reporter } = {}) {
    this.reporter = reporter || createReporter("text");
    this.config = config;
    this.GisName = this.config.name || "test";

    if (this.config.platform) {
      const p = this.config.platform;

      p.codePath = resolveFromCliRoot(p.codePath);
      p.featureModel = resolveFromCliRoot(p.featureModel);
      p.config = resolveFromCliRoot(p.config);
      p.extraJS = resolveFromCliRoot(p.extraJS);
      p.modelTransformation = resolveFromCliRoot(p.modelTransformation);
    }
  }

  async run(geographicFilesFolder, bbox, shouldDeploy, onlyImport) {
    if (!geographicFilesFolder.endsWith(path.sep))
      geographicFilesFolder += path.sep;

    const directories = this.getDirectories(geographicFilesFolder);
    // qgis-project.json, staged by the QGIS plugin alongside the layers it
    // exports — carries display names/order/visibility/opacity/extent the
    // file-extension scan below has no way to discover on its own. null for
    // any staged folder that doesn't have one (older plugin versions, or a
    // non-QGIS caller), in which case every use of it below is a no-op and
    // generation proceeds exactly as it did before this existed.
    const manifest = this.applyBboxOverride(
      readProjectManifest(geographicFilesFolder),
      bbox
    );
    // Create a new instance of the processor
    const processor = new Processor({
      encoding: "utf-8", // 'auto' by default || 'ascii' || 'utf8' || 'utf-8'
      geographicInfo: false, // true by default
      records: false, // true by default
    });

    let geographicFilesInfo = [];

    if (onlyImport) {
      const infoByDirectory = new Map();
      for (const entryPath of directories) {
        infoByDirectory.set(
          entryPath,
          await processor.processFolder(entryPath)
        );
      }
      // The same names a generation run gave the rasters (same directory order)
      const rasterNames = assignRasterNames([...infoByDirectory.values()]);

      for (const [entryPath, info] of infoByDirectory) {
        await uploadGeographicFiles(
          entryPath,
          info,
          this.config.host,
          rasterNames
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

    const reporter = this.reporter;
    const deployment = shouldDeploy ? this.prepareDeploy() : null;
    reporter.plan([
      { id: "read", label: "Read geographic data" },
      { id: "generate", label: "Generate application" },
      ...(deployment ? deployment.uploader.describe(deployment.config) : []),
    ]);

    let dslInstances;
    let allGeographicFilesInfo = [];
    // The GeoServer layer name of every raster, chosen once for the whole run
    // (see raster-util.js) and shared by the DSL and the importer.
    const rasterNames = new Map();

    await reporter.runStep("read", "Read geographic data", async () => {
      dslInstances = createBaseDSLInstance(
        this.GisName,
        this.config.deploy.type == "local"
      );
      // Declared exactly once per run, not once per staged directory (see
      // createBaseTileLayer's docstring) — otherwise a grouped project
      // duplicates the "base" tile layer once per group.
      dslInstances += createBaseTileLayer();
      const usedRasterNames = new Set();
      for (const entryPath of directories) {
        // XYZ tile layers have no file for the reader: the plugin stages them as
        // sidecars (see tile-util.js)
        geographicFilesInfo = [
          ...scopeWmsLayers(
            await processor.processFolder(entryPath),
            entryPath
          ),
          ...readTileSidecars(entryPath),
        ];
        geographicFilesInfo
          .filter((file) => file.type == GeoTypes.TIFF)
          .forEach((file) => {
            if (!rasterNames.has(file.name)) {
              rasterNames.set(
                file.name,
                rasterLayerName(file.name, usedRasterNames)
              );
            }
          });
        const exceptRaster = geographicFilesInfo.filter(
          (file) =>
            file.type != GeoTypes.TIFF &&
            file.type != GeoTypes.WMS &&
            file.type != GeoTypes.XYZ
        );

        if (geographicFilesInfo.length > 0) {
          // Entities/styles/layers get declared exactly once per staged
          // directory, regardless of how many maps end up referencing them —
          // see createLayerDeclarations' docstring for why a repeat CREATE
          // ENTITY isn't safe (gp-gis-dsl throws) even though a repeat
          // reference in a CREATE MAP block is fine.
          dslInstances +=
            createEntityScheme(exceptRaster, manifest) +
            createLayerDeclarations(
              geographicFilesInfo,
              entryPath,
              manifest,
              rasterNames
            );
          allGeographicFilesInfo.push(...geographicFilesInfo);

          // A QGIS group's own directory gets its own dedicated map right
          // here. The root/default directory's map is deferred until every
          // directory has been processed, so it can be the "everything"
          // overview map below instead of just its own (possibly empty, if
          // every layer is grouped) files.
          if (entryPath !== geographicFilesFolder) {
            dslInstances += createMapBlock(
              geographicFilesInfo,
              path.basename(entryPath),
              manifest,
              resolveMapTitle(manifest, entryPath, geographicFilesFolder)
            );
          }
        }
      }

      // The overview map: every layer declared above, from every directory —
      // under the root directory's own identifier/title. Identical to the
      // single map a project with no QGIS groups has always gotten
      // (allGeographicFilesInfo then equals just the root's own files, and
      // entryPath === geographicFilesFolder is true for root, so this call is
      // the exact same one the loop used to make for it).
      if (allGeographicFilesInfo.length > 0) {
        dslInstances += createMapBlock(
          allGeographicFilesInfo,
          path.basename(geographicFilesFolder),
          manifest,
          resolveMapTitle(
            manifest,
            geographicFilesFolder,
            geographicFilesFolder
          )
        );
      }

      dslInstances += endDSLInstance(this.GisName);
    });

    await reporter.runStep("generate", "Generate application", async () => {
      if (DEBUG) {
        fs.writeFileSync("spec.dsl", dslInstances, "utf-8");
      }

      const json = gisdslParser(dslInstances);

      // gp-gis-dsl's WMSLayer.addSubLayer() stores the resolved per-layer style on a
      // field literally named "defaultStyles" (plural) instead of "defaultStyle" —
      // every mini-lps template/Java class that wires GeoServer's default style
      // (layers.json's "defaultStyle" placeholder, GeoServerInit.addLayer()) reads the
      // singular key, finds it missing, and silently never calls setDefaultStyle(),
      // so GeoServer falls back to its own generic style (gray) even though the named
      // custom style was created and is listed as available. Normalize here, at the
      // boundary between the DSL parser and the generator, rather than patching the
      // parser output shape downstream in every consumer.
      for (const layer of json.mapViewer?.layers || []) {
        if (layer.defaultStyle == null && layer.defaultStyles != null) {
          layer.defaultStyle = layer.defaultStyles;
        }
      }

      // WMSStyle.js keeps `sldPath` (the absolute path the SLD was read from inside
      // the staged temp folder, e.g. C:\Users\<user>\AppData\Local\Temp\qgis_...)
      // alongside the already-inlined `sld` body. No mini-lps template reads
      // `sldPath` — it's a leftover that ends up copied verbatim into the shipped
      // product's styles.json. Drop it so a generated app never carries the
      // generating machine's local filesystem layout.
      for (const style of json.mapViewer?.styles || []) {
        delete style.sldPath;
      }

      // Sets map.center and per-layer order/opacity from qgis-project.json — see
      // manifest-util.js for why this happens here (as a direct mutation of the
      // already-parsed spec) rather than through new DSL grammar. A no-op when
      // manifest is null.
      applyManifestToMaps(json, manifest);

      // A projected QGIS project CRS is what Processing models were most likely
      // authored against; hand it to the WPS service's env (deploy/.env).
      const processingCrs = processingCrsFromManifest(manifest);
      if (processingCrs) {
        json.basicData.extra = {
          ...json.basicData.extra,
          processing_crs: processingCrs,
        };
      }

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

      // Every generated project gets the QGIS Processing toolbox
      if (!json.features.includes("MV_Processes")) {
        json.features = [...json.features, "MV_Processes"];
      }

      // Models the user staged. The product template only bundles its demo model
      // when this is empty, so a user's own models aren't listed next to it.
      json.processModels = getModelsFromFolder(
        path.join(geographicFilesFolder, "models")
      );

      const chartsFolder = path.join(geographicFilesFolder, "charts");
      if (!json.chartViewer) json.chartViewer = {};
      json.chartViewer.charts = getChartsFromJson(chartsFolder);

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

      const modelsFolder = path.join(geographicFilesFolder, "models");
      copyModelFiles(modelsFolder, "output");

      // Stage the zipped shapefiles for the generated docker-compose stack's own
      // one-shot importer, regardless of shouldDeploy — otherwise data only ever
      // loads via a separate, explicit `gispublisher --config ...` deploy run.
      // Must run after generateProduct, which owns (and may clean) "output".
      // Generation doesn't wipe old output, and a deployment folder is reused
      // across runs: without clearing the previous data, a layer removed from the
      // project would still be imported.
      fs.rmSync(path.join("output", "deploy", "importer", "data"), {
        recursive: true,
        force: true,
      });
      for (const entryPath of directories) {
        copyGeographicDataForImport(entryPath, "output", rasterNames);
      }
    });

    const outputDir = path.resolve("output");
    if (!deployment) {
      reporter.result({ outputDir });
      return;
    }

    // The data is loaded by the stack's own one-shot `data-importer` service
    // (which skips entities that already have rows), and the deployment only
    // finishes once that service has exited successfully. Importing again from
    // here would duplicate every feature.
    const { url } = await deployment.uploader.deploy(deployment.config, {
      onEvent: (event) => reporter.forward(event),
    });
    reporter.result({ url, outputDir });
  }

  // `--bbox southwest_lng,southwest_lat,northeast_lng,northeast_lat`, documented
  // in usage.txt/README since before this existed, was read (cli.js) and passed
  // through to run() but never actually used anywhere — a manual override of the
  // map's extent is exactly what qgis-project.json's `project.extent` now drives
  // (see manifest-util.js's applyManifestToMaps), so this wires the flag into
  // that same mechanism instead of leaving it silently dead.
  applyBboxOverride(manifest, bbox) {
    if (!bbox) return manifest;

    const parts = String(bbox)
      .split(",")
      .map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
      console.warn(
        `Ignoring --bbox "${bbox}": expected 4 comma-separated numbers ` +
          "(southwest_lng,southwest_lat,northeast_lng,northeast_lat)."
      );
      return manifest;
    }
    const [xmin, ymin, xmax, ymax] = parts;

    return {
      project: {
        ...(manifest?.project || {}),
        extent: { crs: "EPSG:4326", xmin, ymin, xmax, ymax },
      },
      layersByStaged: manifest?.layersByStaged || {},
    };
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

  /**
   * The uploader (strategy chosen by `deploy.type`) and its configuration for
   * this run. AWS instances are created by the strategy itself, as one of its
   * reported steps.
   */
  prepareDeploy() {
    const uploader = new Uploader();

    const strategies = {
      ssh: () => new DebianUploadStrategy(),
      aws: () => new AWSUploadStrategy(),
      local: () => new LocalUploadStrategy(),
    };
    const type = String(this.config.deploy.type || "local").toLowerCase();
    uploader.setUploadStrategy((strategies[type] || strategies.local)());

    // No `projectName`: the generated stack names its own compose project
    // (COMPOSE_PROJECT_NAME in deploy/.env), which is also what deployments made
    // by earlier versions used, so a redeploy replaces them instead of clashing
    // with their fixed container names.
    const config = {
      ...this.config.deploy,
      repoPath: path.resolve("output"),
    };
    // Where the app answers, when the config says so (the local deployment's
    // "http://localhost:80"); ssh/aws derive it from the host they deploy to.
    if (/^https?:\/\//.test(this.config.host || "")) {
      config.url = this.config.host;
    }

    return { uploader, config };
  }
}
