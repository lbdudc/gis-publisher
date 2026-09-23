import { upperCamelCase, lowerCamelCase } from "./str-util.js";
import { generateRandomHexColor } from "./color-util.js";
import path from "path";

const TAB = "  ";
const EOL = "\n";

const toFloatLiteral = (n) => (Number.isInteger(n) ? `${n}.0` : `${n}`);

// gp-gis-dsl's QUOTED_TEXT token (`QUOTE_SYMBOL (~[\r\n'"])* QUOTE_SYMBOL`) has no
// escape mechanism at all: a value containing a straight quote or a newline breaks
// the parser outright. Staged file basenames (sh.name) are already plugin-sanitized
// and safe to interpolate as-is, but text sourced from the QGIS project itself
// (project title, layer display name, via the qgis-project.json manifest) is raw
// user text with no such guarantee — sanitize it before it ever reaches an
// `AS "..."` clause.
const sanitizeDslText = (text) =>
  text == null
    ? text
    : String(text)
        .replace(/[\r\n]+/g, " ")
        .replace(/["']/g, "");

// The DSL layer identifier gispublisher derives for a staged, non-external-WMS
// entry — shared between createMapFromEntity (which emits it) and main.js's
// post-processing step (which needs to map the parsed spec's per-map layer
// entries, keyed by this same identifier, back to their qgis-project.json
// manifest entry) so the naming convention is defined exactly once.
export const dslLayerId = (stagedName) => `${lowerCamelCase(stagedName)}Layer`;

export function createBaseDSLInstance(name, local) {
  let str = `CREATE GIS ${name} USING 4326;${EOL}`;
  str += `USE GIS ${name};${EOL}${EOL}`;

  if (!local) {
    str += `SET DEPLOYMENT (${EOL}`;
    str += `  "client_deploy_url" "http://gis.lbd.org.es",${EOL}`;
    str += `  "geoserver_user" "admin",${EOL}`;
    str += `  "geoserver_password" "geoserver",${EOL}`;
    str += `  "server_deploy_url" "http://gis.lbd.org.es/backend",${EOL}`;
    str += `  "geoserver_url_wms" "http://gis.lbd.org.es/geoserver",${EOL}`;
    str += `  "server_deploy_port" "9001"${EOL}`;
    str += `);${EOL}${EOL}`;
  } else {
    str += `SET DEPLOYMENT (${EOL}`;
    str += `  "geoserver_user" "admin",${EOL}`;
    // No geoserver_url_wms override here: leave it unset so the generated
    // client's .env.production falls through to its own D_C_Geoserver/
    // D_C_Nginx-aware default, which routes WMS requests through nginx's
    // /geoserver/ proxy when nginx is part of the stack (as server_deploy_url
    // already does below for the backend) instead of always hitting
    // GeoServer's own port directly.
    str += `  "geoserver_password" "geoserver"${EOL}`;
    str += `);${EOL}${EOL}`;
  }

  return str;
}

export function endDSLInstance(name) {
  return `GENERATE GIS ${name};${EOL}`;
}

export const createEntityScheme = (values, manifest = null) => {
  let schemaSyntax = ``;

  const TYPES_REL = {
    Number: "Long",
    String: "String",
  };

  const layersByStaged = manifest?.layersByStaged || {};

  values.forEach((value) => {
    schemaSyntax += `CREATE ENTITY ${upperCamelCase(value.name)} (${EOL}`;

    // Add the id field, which is the first one
    schemaSyntax += `${TAB}id Long IDENTIFIER DISPLAY_STRING`;

    // Manifest field aliases are keyed by staged DBF field name (see
    // core.project_manifest.remap_field_aliases on the plugin side) — exactly
    // schema.name below, before the "id" -> "id2" collision rename mutates it.
    const aliasByFieldName = {};
    for (const f of layersByStaged[value.name]?.fields || []) {
      if (f?.name && f.alias) aliasByFieldName[f.name] = f.alias;
    }

    // If there are more fields
    if (value.schema.length > 0) {
      schemaSyntax +=
        `,${EOL}` +
        value.schema
          .map((schema) => {
            const alias = aliasByFieldName[schema.name];
            if (schema.name == "id") {
              schema.name += "2";
            }
            const asClause = alias ? ` AS "${sanitizeDslText(alias)}"` : "";
            return `${TAB}${lowerCamelCase(schema.name)} ${
              TYPES_REL[schema.type] || schema.type
            }${asClause}`;
          })
          .join(`,${EOL}`) +
        `${EOL}`;
    }

    schemaSyntax += `);${EOL}${EOL}`;
  });

  return schemaSyntax;
};

export function createMapFromEntity(
  shapefileInfo,
  shapefilesFolder,
  mapName = "test",
  manifest = null
) {
  let mapSyntax = ``;

  // layersByStaged keys exactly match sh.name (see manifest-util.js's
  // readProjectManifest / the plugin's naming.assign_staged_basenames) — a
  // missing manifest, or a staged entry the manifest doesn't know about (an
  // older plugin version, or a WMS/model/chart sidecar), falls through to
  // today's behaviour unchanged.
  const layersByStaged = manifest?.layersByStaged || {};
  const mapTitle = sanitizeDslText(manifest?.project?.title) || mapName;

  const geometryColumn = ["geometry", "geom"];

  mapSyntax += `CREATE TILE LAYER base AS "OpenStreetMap" (${EOL}`;
  mapSyntax += `${TAB}url "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;

  mapSyntax += shapefileInfo
    .map((sh) => {
      console.log(sh);
      let sentence = "";
      const isRaster = sh.type?.toLowerCase() === "geotiff";
      const isWms = sh.type?.toLowerCase() === "wms";
      const isExternalWms = isWms && Array.isArray(sh.schema);
      let geometryType = null;
      if (!isRaster && !isExternalWms && sh.schema?.length) {
        geometryType = sh.schema.find((s) =>
          geometryColumn.includes(s.name)
        )?.type;
      }

      // We use this custom geom so that the annotated code can apply the correct styles,
      // only for the custom styles
      const CUSTOM_GEOM = {
        MultiLineString: "LineString",
        MultiPolygon: "Polygon",
        MultiPoint: "Point",
      };

      if (isExternalWms) {
        for (const layer of sh.schema) {
          sentence +=
            `CREATE WMS LAYER ${layer.layerTitle} AS "${layer.layerTitle}" (${EOL}` +
            `${TAB}urlWms "${layer.url}",${EOL}` +
            `${TAB}layerName "${layer.layerName}",${EOL}` +
            `${TAB}format "${layer.format}",${EOL}` +
            `${TAB}crs "${layer.crs?.[0] || "EPSG:4326"}",${EOL}` +
            (layer.styles?.length
              ? `${TAB}style "${layer.styles[0]}",${EOL}`
              : ``) +
            `${TAB}queryable "${layer.queryable ? "true" : "false"}",${EOL}` +
            (layer.bbox
              ? `${TAB}bboxCRS "${layer.bbox.crs}",${EOL}` +
                `${TAB}minX ${toFloatLiteral(layer.bbox.minx)},${EOL}` +
                `${TAB}minY ${toFloatLiteral(layer.bbox.miny)},${EOL}` +
                `${TAB}maxX ${toFloatLiteral(layer.bbox.maxx)},${EOL}` +
                `${TAB}maxY ${toFloatLiteral(layer.bbox.maxy)},${EOL}`
              : ``) +
            `${TAB}version "${layer.version || "1.3.0"}"${EOL}` +
            `);${EOL}${EOL}`;
        }
        return sentence;
      } else {
        if (sh.hasSld) {
          sentence +=
            `CREATE WMS STYLE ${lowerCamelCase(sh.name)}LayerStyle (${EOL}` +
            `${TAB}styleLayerDescriptor "${path.join(
              shapefilesFolder,
              sh.name + ".sld"
            )}"${EOL}` +
            `);${EOL}${EOL}`;
        } else {
          const geometry = isRaster
            ? CUSTOM_GEOM.MultiPoint
            : CUSTOM_GEOM[geometryType] || geometryType;

          sentence +=
            `CREATE WMS STYLE ${lowerCamelCase(sh.name)}LayerStyle (${EOL}` +
            `${TAB}geometryType ${geometry},${EOL}` +
            `${TAB}fillColor ${generateRandomHexColor(sh.name)},${EOL}` +
            `${TAB}strokeColor ${generateRandomHexColor(
              sh.name,
              true
            )},${EOL}` +
            `${TAB}fillOpacity 0.7,${EOL}` +
            `${TAB}strokeOpacity 1${EOL}` +
            `);${EOL}${EOL}`;
        }
      }

      const label = sanitizeDslText(layersByStaged[sh.name]?.title) || sh.name;
      sentence +=
        `CREATE WMS LAYER ${dslLayerId(sh.name)} AS "${label}" (${EOL}` +
        `${TAB}${upperCamelCase(sh.name)} ${lowerCamelCase(
          sh.name
        )}LayerStyle${EOL}` +
        `);${EOL}${EOL}`;

      return sentence;
    })
    .join(EOL);

  // Order the map's layer list by the manifest's QGIS layer-tree order (an
  // entry the manifest doesn't cover — an older plugin, or an external WMS
  // sublayer, which isn't staged as a file and so has no manifest entry —
  // sorts after every ordered one, keeping its original relative position:
  // gp-gis-dsl's Map.addLayer preserves declaration order into `map.layers[]`,
  // and mini-lps's map-common.js sorts overlays with a comparator that
  // returns 0 for two undefined `.order`s, which Array.prototype.sort must
  // treat as stable per spec — so declaration order alone already controls
  // the visual order on a manifest-less/partial run exactly as it does today).
  const orderedEntries = shapefileInfo
    .flatMap((sh) => {
      const isExternalWms =
        sh.type?.toLowerCase() === "wms" && Array.isArray(sh.schema);
      if (isExternalWms) {
        return sh.schema.map((l) => ({
          id: l.layerTitle,
          order: null,
          hidden: false,
        }));
      }
      const manifestEntry = layersByStaged[sh.name];
      return [
        {
          id: dslLayerId(sh.name),
          order: manifestEntry?.order,
          hidden: manifestEntry?.visible === false,
        },
      ];
    })
    .map((entry, index) => ({ ...entry, _i: index }))
    .sort((a, b) => {
      const orderA = a.order != null ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB = b.order != null ? b.order : Number.MAX_SAFE_INTEGER;
      return orderA !== orderB ? orderA - orderB : a._i - b._i;
    });

  // SORTABLE (not just MAP): enables MV_LM_Order's reorder-layers UI, and
  // costs nothing when there's no manifest to sort by.
  mapSyntax += `CREATE SORTABLE MAP ${mapName} AS "${mapTitle}" (${EOL}`;
  mapSyntax += `${TAB}base IS_BASE_LAYER,${EOL}`;
  mapSyntax += orderedEntries
    .map((entry) => `${TAB}${entry.id}${entry.hidden ? " HIDDEN" : ""}`)
    .join(`,${EOL}`);
  mapSyntax += `${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;

  return mapSyntax;
}
