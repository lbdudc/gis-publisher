import fs from "fs";
import path from "path";
import { dslLayerId } from "./dsl-util.js";

const MANIFEST_FILENAME = "qgis-project.json";

/**
 * Reads the optional qgis-project.json sidecar the QGIS plugin stages next to
 * the layers it exports (see qgispublisher-plugin/core/project_manifest.py),
 * carrying QGIS-side metadata the CLI's file-extension scan has no way to
 * discover on its own: the project's title/extent, and per-layer display
 * name/visibility/order/opacity/scale range/field aliases.
 *
 * Returns `{ project, layersByStaged, groups }` — `layersByStaged` keyed by
 * each layer entry's `staged` basename, which is exactly the CLI's own
 * `sh.name` (see gp-geographic-info-reader's FileProcessor.js:
 * `fileName.split(".")[0]`); `groups` keyed by a staged group *directory*
 * name (i.e. `path.basename(entryPath)` for a group subdirectory) to that
 * QGIS group's original display name, for a map's label — see
 * `resolveMapTitle` below. Returns `null` if the manifest is absent,
 * unreadable, or malformed.
 *
 * A `null`/partial result must never break generation: every caller treats a
 * missing manifest exactly like every gispublisher release before this one
 * (older plugin versions that don't stage a manifest at all keep working
 * unchanged), and a manifest entry with fields missing/of the wrong type is
 * simply not applied for that field rather than raising.
 */
export function readProjectManifest(folder) {
  const manifestPath = path.join(folder, MANIFEST_FILENAME);

  let raw;
  try {
    raw = fs.readFileSync(manifestPath, "utf-8");
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`Ignoring malformed ${MANIFEST_FILENAME}: ${err.message}`);
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;

  const layersByStaged = {};
  for (const entry of Array.isArray(parsed.layers) ? parsed.layers : []) {
    if (entry && typeof entry === "object" && entry.staged) {
      layersByStaged[entry.staged] = entry;
    }
  }

  return {
    project: parsed.project || {},
    layersByStaged,
    groups:
      parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {},
  };
}

/**
 * The label a map built from `entryPath` should carry: the QGIS project's
 * own title for the default/ungrouped map (`entryPath === rootFolder`), the
 * original QGIS group name for a group map (looked up by the staged
 * directory name in `manifest.groups` — see readProjectManifest), or
 * `path.basename(entryPath)` when neither is available (no manifest, an
 * older plugin version, or a directory the manifest doesn't know about).
 */
export function resolveMapTitle(manifest, entryPath, rootFolder) {
  const dirName = path.basename(entryPath);
  if (entryPath === rootFolder) {
    return manifest?.project?.title || dirName;
  }
  return manifest?.groups?.[dirName] || dirName;
}

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

// Scale denominator of a Web-Mercator tile pyramid at zoom 0 (256px tiles, 96
// dpi) — the same convention QGIS uses for its own "scale" figure, so
// zoom = log2(this / scale).
const WEB_MERCATOR_ZOOM0_SCALE = 559082264.028;
const MAX_ZOOM = 24;

/**
 * Converts a QGIS scale-based-visibility range into Leaflet's `minZoom` /
 * `maxZoom` layer options. QGIS's `minScale` is the *most zoomed-out* scale
 * the layer still shows at (exclusive) and `maxScale` the most zoomed-in
 * (inclusive), so `minScale` bounds the zoom from below and `maxScale` from
 * above. A missing/0 scale means "no limit" on that side. Returns `{}` when
 * there is nothing to apply, or when the range is empty after rounding to
 * whole zoom levels (Leaflet can't show a layer at "zoom 5.4 to 5.6").
 */
export function zoomLimitsFromScales(minScale, maxScale) {
  const limits = {};
  if (isFiniteNumber(minScale) && minScale > 0) {
    limits.minZoom = Math.max(
      0,
      Math.ceil(Math.log2(WEB_MERCATOR_ZOOM0_SCALE / minScale))
    );
  }
  if (isFiniteNumber(maxScale) && maxScale > 0) {
    limits.maxZoom = Math.min(
      MAX_ZOOM,
      Math.floor(Math.log2(WEB_MERCATOR_ZOOM0_SCALE / maxScale))
    );
  }
  if (
    limits.minZoom !== undefined &&
    limits.maxZoom !== undefined &&
    limits.minZoom > limits.maxZoom
  ) {
    return {};
  }
  return limits;
}

/**
 * `mapOptions.crs` (what mini-lps's map-common.js hands to `new L.Proj.CRS`)
 * for the QGIS project's own projected CRS, or `null` when the plugin didn't
 * ask for it (`project.useProjectCrs`), the CRS is geographic / Web Mercator,
 * or the manifest lacks the proj4 string or the extent in that CRS.
 * Resolutions halve per zoom from "whole extent in one 256px tile" — enough
 * levels to zoom in to street scale for any realistic project extent.
 */
export function displayCrsFromManifest(manifest) {
  const project = manifest?.project;
  const crs = project?.crs;
  const extent = project?.extentProjected;
  if (!project?.useProjectCrs || !crs || crs.isGeographic !== false)
    return null;
  if (typeof crs.proj4 !== "string" || !crs.proj4) return null;
  if (
    !/^[A-Za-z]+:\d+$/.test(crs.authid) ||
    ["EPSG:3857", "EPSG:900913"].includes(crs.authid)
  )
    return null;
  if (
    !extent ||
    !["xmin", "ymin", "xmax", "ymax"].every((k) => isFiniteNumber(extent[k])) ||
    extent.xmax <= extent.xmin ||
    extent.ymax <= extent.ymin
  )
    return null;

  const size = Math.max(extent.xmax - extent.xmin, extent.ymax - extent.ymin);
  const resolutions = Array.from({ length: 22 }, (_, z) => size / 256 / 2 ** z);
  return {
    srid: crs.authid,
    proj4Config: {
      params: crs.proj4,
      options: { resolutions, origin: [extent.xmin, extent.ymax] },
    },
  };
}

/**
 * The project's spatial bookmarks as `[{ name, bounds: [[south, west],
 * [north, east]] }]` (Leaflet `fitBounds` order), skipping malformed entries.
 */
export function bookmarksFromManifest(manifest) {
  const list = manifest?.project?.bookmarks;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (b) =>
        b &&
        typeof b.name === "string" &&
        b.name.trim() &&
        isFiniteNumber(b.xmin) &&
        isFiniteNumber(b.ymin) &&
        isFiniteNumber(b.xmax) &&
        isFiniteNumber(b.ymax)
    )
    .map((b) => ({
      name: sanitizeBookmarkName(b.name),
      bounds: [
        [b.ymin, b.xmin],
        [b.ymax, b.xmax],
      ],
    }));
}

const sanitizeBookmarkName = (name) => name.replace(/[\r\n\t]+/g, " ").trim();

/**
 * The CRS the generated app's WPS service should run models in: the plugin's
 * explicit "Run models in CRS" choice, else the QGIS project's own CRS authid
 * (e.g. "EPSG:25829") when it is a *projected* one, else `null`. The generated app stores and serves everything in
 * EPSG:4326, so QGIS Processing models that were authored for a metric CRS
 * (a buffer of 2000 "metres", say) need the WPS service to work in that CRS
 * instead — see mini-lps's `QGSWPS_PROCESSING_CRS`.
 */
export function processingCrsFromManifest(manifest) {
  const isAuthid = (v) => typeof v === "string" && /^[A-Za-z]+:\d+$/.test(v);

  // An explicit choice made in the plugin ("Run models in CRS") wins
  const override = manifest?.project?.processingCrs;
  if (isAuthid(override)) return override;

  const crs = manifest?.project?.crs;
  if (!crs || !isAuthid(crs.authid) || crs.isGeographic !== false) return null;
  return crs.authid;
}

/**
 * Sets whatever the DSL/gp-gis-dsl parser has no syntax for at all — per-map
 * `center` and per-map-layer numeric `order`/`opacity` — directly on the
 * already-parsed spec object, rather than round-tripping through new grammar.
 * mini-lps's client already reads every one of these fields
 * (client/src/components/map-viewer/common/map-common.js's `order`/`opacity`,
 * config-files/maps.json's `center`); nothing here changes what the templates
 * expect, only what actually reaches them.
 *
 * `manifest` may be null (nothing to apply, a no-op) or partial (only the
 * fields it actually has are set). Mutates `json` in place and returns it.
 */
export function applyManifestToMaps(json, manifest) {
  if (!manifest || !json?.mapViewer?.maps) return json;

  const extent = manifest.project?.extent;
  const hasValidExtent =
    extent &&
    isFiniteNumber(extent.xmin) &&
    isFiniteNumber(extent.ymin) &&
    isFiniteNumber(extent.xmax) &&
    isFiniteNumber(extent.ymax);

  // The parsed spec's map.layers[].name is the DSL identifier
  // (dslLayerId(stagedName), e.g. "municipiosLayer"), not the staged
  // basename the manifest is keyed by ("municipios") — re-derive that same
  // mapping here rather than have the manifest carry a second, redundant key.
  const manifestByDslId = {};
  for (const [staged, entry] of Object.entries(manifest.layersByStaged || {})) {
    manifestByDslId[dslLayerId(staged)] = entry;
  }

  const bookmarks = bookmarksFromManifest(manifest);
  const displayCrs = displayCrsFromManifest(manifest);

  for (const map of json.mapViewer.maps) {
    if (bookmarks.length > 0) map.bookmarks = bookmarks;
    if (displayCrs) {
      map.mapOptions = { ...map.mapOptions, crs: displayCrs };
      // OSM/Esri base tiles only exist in Web Mercator: under another CRS
      // they would draw at the wrong place, so they are left out of this map.
      map.layers = (map.layers || []).filter((l) => !l.baseLayer);
    }
    if (hasValidExtent) {
      // A plain [[southWestLat, southWestLng], [northEastLat, northEastLng]]
      // pair — Leaflet's LatLngBounds normalizes min/max from any two corner
      // points, so the exact corner convention doesn't matter, only that both
      // corners are present and in [lat, lng] order.
      map.center = [
        [extent.ymin, extent.xmin],
        [extent.ymax, extent.xmax],
      ];
    }

    for (const layerEntry of map.layers || []) {
      const manifestEntry = manifestByDslId[layerEntry.name];
      if (!manifestEntry) continue;
      if (isFiniteNumber(manifestEntry.opacity))
        layerEntry.opacity = manifestEntry.opacity;
      // .order is already correct from dsl-util.js's declaration-order sort
      // (see createMapFromEntity) — Map.addLayer never writes an .order field
      // at all, so setting one here is purely additive precision, matching
      // exactly what the sort already produced.
      if (isFiniteNumber(manifestEntry.order))
        layerEntry.order = manifestEntry.order;
      Object.assign(
        layerEntry,
        zoomLimitsFromScales(manifestEntry.minScale, manifestEntry.maxScale)
      );
    }
  }

  return json;
}
