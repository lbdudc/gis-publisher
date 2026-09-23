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
 * Returns `{ project, layersByStaged }` — `layersByStaged` keyed by each
 * layer entry's `staged` basename, which is exactly the CLI's own `sh.name`
 * (see gp-geographic-info-reader's FileProcessor.js: `fileName.split(".")[0]`)
 * — or `null` if the manifest is absent, unreadable, or malformed.
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

  return { project: parsed.project || {}, layersByStaged };
}

const isFiniteNumber = (n) => typeof n === "number" && Number.isFinite(n);

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

  for (const map of json.mapViewer.maps) {
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
    }
  }

  return json;
}
