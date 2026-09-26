import { DerivationEngine, readJsonFromFile, readFile } from "spl-js-engine";
import {
  Uploader,
  DebianUploadStrategy,
  AWSUploadStrategy,
  HetznerStrategy,
  DigitalOceanStrategy,
  LocalUploadStrategy,
  PackageStrategy,
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
  normalizeSpecTypes,
} from "./dsl-util.js";
import gisdslParser from "@lbdudc/gp-gis-dsl";
import fs from "fs";
import { getChartsFromJson } from "./chart-util.js";
import { copyModelFiles, getModelsFromFolder } from "./model-util.js";
import {
  copyGeographicDataForImport,
  createImportStaging,
  planImportData,
} from "./import-util.js";
import { checkDataUpdate } from "./update-data.js";
import { withEnvCredentials } from "./credentials-util.js";
import { editAuth } from "./edit-auth.js";
import {
  applyPackageToSpec,
  applyPublicDeployToSpec,
  deploySecrets,
  domainOf,
  isPublicDeploy,
  packageSecrets,
  publicUrlFor,
} from "./public-deploy.js";
import { packageFiles } from "./package-util.js";
import { editedLayersInfo } from "./import-util.js";
import { assignRasterNames, rasterLayerName } from "./raster-util.js";
import { readTileSidecars } from "./tile-util.js";
import { applyLiveLayersToSpec, readLiveSidecars } from "./live-util.js";
import { scopeWmsLayers } from "./wms-util.js";
import {
  readProjectManifest,
  applyManifestToMaps,
  applyManifestToSpec,
  hasTemporalLayers,
  hasEditableLayers,
  resolveMapTitle,
  processingCrsFromManifest,
} from "./manifest-util.js";
import {
  appOptionsFromManifest,
  applyFeatureOptions,
  applyBrandingToSpec,
  basemapFromManifest,
  brandingFromManifest,
} from "./options-util.js";
import { stageBrandingLogo, BRANDING_DIR } from "./branding-util.js";

import {
  dataModelFingerprint,
  decideResetData,
  saveDeployState,
} from "./deploy-state.js";
import { uploadGeographicFiles } from "./geographic-files-importer.js";
import { createReporter } from "./progress.js";

import { fileURLToPath } from "url";

const DEBUG = process.env.DEBUG;

const GeoTypes = {
  TIFF: "geoTIFF",
  SHAPEFILE: "shapefile",
  WMS: "wms",
  XYZ: "xyz",
  LIVE: "live",
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

  async run(geographicFilesFolder, bbox, shouldDeploy, onlyImport, updateData) {
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
    // An update-data run always goes to a deployment, and never regenerates the app
    const deployment = shouldDeploy || updateData ? this.prepareDeploy() : null;
    // Generating can also end in a zip of the app (with a README and start scripts): the app is
    // then the portable flavour, made to be started on some other machine
    const zipping = this.config.zip === true && !shouldDeploy && !updateData;
    reporter.plan([
      { id: "read", label: "Read geographic data" },
      {
        id: "generate",
        label: updateData ? "Prepare the data" : "Generate application",
      },
      ...(zipping ? [{ id: "package", label: "Create the zip" }] : []),
      ...(deployment
        ? updateData
          ? deployment.uploader.describeUpdate(deployment.config)
          : deployment.uploader.describe(deployment.config)
        : []),
    ]);

    let dslInstances;
    let allGeographicFilesInfo = [];
    // The GeoServer layer name of every raster, chosen once for the whole run
    // (see raster-util.js) and shared by the DSL and the importer.
    const rasterNames = new Map();
    let dataModelHash = null;
    let editAccount = null; // {user, password, htpasswd} when the app has editable layers
    let hasEditing = false;

    await reporter.runStep("read", "Read geographic data", async () => {
      dslInstances = createBaseDSLInstance(this.GisName);
      // Declared exactly once per run, not once per staged directory (see
      // createBaseTileLayer's docstring) — otherwise a grouped project
      // duplicates the "base" tile layer once per group.
      dslInstances += createBaseTileLayer(basemapFromManifest(manifest));
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
          // PostGIS/WFS layers the app's GeoServer reads from their source
          ...readLiveSidecars(entryPath),
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
            file.type != GeoTypes.XYZ &&
            file.type != GeoTypes.LIVE
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

    await reporter.runStep(
      "generate",
      updateData ? "Prepare the data" : "Generate application",
      async () => {
        if (DEBUG) {
          fs.writeFileSync("spec.dsl", dslInstances, "utf-8");
        }

        const json = normalizeSpecTypes(gisdslParser(dslInstances));

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
        // Hidden columns, value maps and map tips of the QGIS layers
        applyManifestToSpec(json, manifest);
        // The live PostGIS/WFS layers: the app's GeoServer connects to their source
        applyLiveLayersToSpec(
          json,
          allGeographicFilesInfo.filter((file) => file.type == GeoTypes.LIVE),
          manifest
        );

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

        // The web-app options chosen in the plugin (search, legend, downloads...)
        json.features = applyFeatureOptions(
          json.features,
          appOptionsFromManifest(manifest)
        );
        // A layer with QGIS temporal settings gets the time slider
        if (
          hasTemporalLayers(json) &&
          !json.features.includes("MV_T_TimeSlider")
        ) {
          json.features = [...json.features, "MV_T_TimeSlider"];
        }
        // Editable layers turn editing on; changing data then needs the editing password
        // (nginx checks it against the hash the app carries)
        hasEditing = hasEditableLayers(json);
        if (hasEditing) {
          if (!json.features.includes("MV_T_Editing")) {
            json.features = [...json.features, "MV_T_Editing"];
          }
          editAccount = editAuth(process.cwd());
          json.basicData = {
            ...json.basicData,
            extra: {
              ...json.basicData?.extra,
              edit_htpasswd: editAccount.htpasswd,
            },
          };
        }
        // Title, primary colour and logo of the app; the logo file itself is copied
        // once the product exists (below)
        applyBrandingToSpec(json, manifest, {
          logoUrl: stageBrandingLogo(geographicFilesFolder, manifest)
            ? `img/branding/${brandingFromManifest(manifest).logo}`
            : undefined,
        });

        // A deployment to another machine: its own passwords, its public address, and
        // no internal service port left open to the network
        if (zipping) {
          applyPackageToSpec(json, { secrets: packageSecrets(process.cwd()) });
        } else if (isPublicDeploy(this.config.deploy)) {
          applyPublicDeployToSpec(json, {
            publicUrl: publicUrlFor(this.config.deploy, this.config.host),
            secrets: deploySecrets(process.cwd()),
            domain: domainOf(this.config.deploy),
            acmeEmail: this.config.deploy.acmeEmail,
            internalCertificate:
              this.config.deploy.internalCertificate === true,
          });
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
        dataModelHash = dataModelFingerprint(json);

        if (updateData) {
          // Same layers and fields as the deployed app: only their data is new. The app is
          // not generated again; the importer files are replaced and the importer runs.
          const planned = planImportData(directories, "output", rasterNames);
          const verdict = checkDataUpdate({
            outputDir: path.resolve("output"),
            fingerprint: dataModelHash,
            plannedFiles: Object.keys(planned),
          });
          if (!verdict.ok) throw new Error(verdict.reason);

          const staging = createImportStaging("output");
          for (const entryPath of directories) {
            copyGeographicDataForImport(
              entryPath,
              "output",
              rasterNames,
              staging
            );
          }
          staging.finish(editedLayersInfo(manifest, this.config.deploy));
          return;
        }

        const engine = await new DerivationEngine({
          codePath: this.config.platform.codePath,
          featureModel: readFile(this.config.platform.featureModel),
          config: readJsonFromFile(this.config.platform.config),
          extraJS: readFile(this.config.platform.extraJS),
          modelTransformation: readFile(
            this.config.platform.modelTransformation
          ),
          verbose: DEBUG,
        });

        engine.generateProduct("output", readJsonFromFile("spec.json"));

        const modelsFolder = path.join(geographicFilesFolder, "models");
        copyModelFiles(modelsFolder, "output");
        stageBrandingLogo(geographicFilesFolder, manifest, "output");

        // Stage the zipped shapefiles for the generated docker-compose stack's own
        // one-shot importer, regardless of shouldDeploy — otherwise data only ever
        // loads via a separate, explicit `gispublisher --config ...` deploy run.
        // Must run after generateProduct, which owns (and may clean) "output".
        // Generation doesn't wipe old output, and a deployment folder is reused
        // across runs: `staging.finish()` drops the files of layers removed from the
        // project (they would still be imported) and leaves unchanged files alone.
        const staging = createImportStaging("output");
        for (const entryPath of directories) {
          copyGeographicDataForImport(
            entryPath,
            "output",
            rasterNames,
            staging
          );
        }
        staging.finish(editedLayersInfo(manifest, this.config.deploy));
      }
    );

    const outputDir = path.resolve("output");
    if (!deployment) {
      let file;
      if (zipping) {
        // Nothing is deployed, so nothing is recorded as deployed (deploy-state.js)
        ({ file } = await new PackageStrategy().deploy(
          {
            type: "package",
            repoPath: outputDir,
            file: path.resolve(
              this.config.zipFile ||
                `${this.GisName}-${this.config.version || "1.0.0"}.zip`
            ),
            name: this.GisName,
            extraFiles: packageFiles({
              name: this.GisName,
              editing: hasEditing,
            }),
          },
          { onEvent: (event) => reporter.forward(event) }
        ));
      }
      reporter.result({ outputDir, file, editAccount });
      return;
    }

    if (updateData) {
      const { url } = await deployment.uploader.updateData(deployment.config, {
        onEvent: (event) => reporter.forward(event),
      });
      reporter.result({ url, outputDir, editAccount });
      return;
    }

    // A redeploy keeps the database: only a changed data model needs a clean one.
    const reset = decideResetData(
      outputDir,
      dataModelHash,
      deployment.config.resetData
    );
    deployment.config.resetData = reset.resetData;
    if (reset.resetData) {
      console.info(`Starting from an empty database: ${reset.reason}.`);
    }

    // The data is loaded by the stack's own one-shot `data-importer` service
    // (which only loads the layers that are new or changed), and the deployment
    // only finishes once that service has exited successfully. Importing again
    // from here would duplicate every feature.
    const { url } = await deployment.uploader.deploy(deployment.config, {
      onEvent: (event) => reporter.forward(event),
    });
    saveDeployState(outputDir, dataModelHash);
    reporter.result({ url, outputDir, editAccount });
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
      groups: manifest?.groups || {},
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

    // Include subdirectories (excluding "output", and the branding files, which
    // are not geographic data)
    directories.push(
      ...entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name !== "output" &&
            entry.name !== BRANDING_DIR
        )
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
      hetzner: () => new HetznerStrategy(),
      digitalocean: () => new DigitalOceanStrategy(),
      local: () => new LocalUploadStrategy(),
    };
    const type = String(this.config.deploy.type || "local").toLowerCase();
    uploader.setUploadStrategy((strategies[type] || strategies.local)());

    // No `projectName`: the generated stack names its own compose project
    // (COMPOSE_PROJECT_NAME in deploy/.env), which is also what deployments made
    // by earlier versions used, so a redeploy replaces them instead of clashing
    // with their fixed container names.
    const config = {
      ...withEnvCredentials(this.config.deploy),
      repoPath: path.resolve("output"),
    };
    // Where the app answers, when the config says so (the local deployment's
    // "http://localhost:80"); ssh/aws derive it from the host they deploy to.
    if (/^https?:\/\//.test(this.config.host || "")) {
      config.url = this.config.host;
    }
    // With a domain the app answers over HTTPS there, whatever the target
    if (domainOf(config)) {
      config.url = publicUrlFor(config, this.config.host);
    }

    return { uploader, config };
  }
}
