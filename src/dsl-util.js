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

// A URL goes in a quoted DSL text too, which can't hold a quote at all: they are
// percent-encoded (a valid URL never contains a raw one anyway).
const dslUrl = (url) =>
  String(url)
    .replace(/[\r\n]+/g, "")
    .replace(/"/g, "%22")
    .replace(/'/g, "%27");

// Attribution is shown as HTML by Leaflet: keep only its text, and write the
// quotes as entities so they can't end the DSL text.
const dslAttribution = (html) =>
  String(html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// The DSL layer identifier gispublisher derives for a staged, non-external-WMS
// entry — shared between createLayerDeclarations/createMapBlock (which emit
// it) and main.js's post-processing step (which needs to map the parsed
// spec's per-map layer entries, keyed by this same identifier, back to their
// qgis-project.json manifest entry) so the naming convention is defined
// exactly once.
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

// A staged file can only be declared as an entity/WMS layer/WMS style
// *once* — gp-gis-dsl's addEntity throws "Entity <name> already exists" on a
// second CREATE ENTITY for the same name (addLayer/addStyle don't throw, but
// a repeat is still pure waste). So when the same layer needs to show up in
// more than one map (e.g. a QGIS group's own map *and* an overview map with
// everything), it's declared once with createLayerDeclarations and then
// referenced by identifier from as many createMapBlock calls as needed — a
// CREATE MAP block only needs the identifier to already exist somewhere
// earlier in the DSL text (gp-gis-dsl's visitCreateMap does `getLayer(l.id)`
// against everything parsed so far, not just the current statement), not to
// redeclare it. main.js is the only caller of both, and is what makes that
// call: entities/styles/layers get declared once per staged directory, but
// the DSL's CREATE MAP list for a directory's own map plus the final
// "everything" map are built separately from the same declarations.
/**
 * The `CREATE TILE LAYER base ...` DSL declaration, factored out of
 * createLayerDeclarations so main.js can emit it exactly once per run
 * (see createBaseTileLayer's call site) instead of once per staged
 * directory. gp-gis-dsl's addLayer() — unlike addEntity() — never throws on
 * a repeat identifier, so a per-directory `base` declaration didn't fail a
 * grouped project's generation, it just silently duplicated: the generated
 * layers.json ended up with two `"name": "base"` entries and the locale
 * files' `layer-label` block got a duplicate JSON key.
 */
export function createBaseTileLayer() {
  let mapSyntax = `CREATE TILE LAYER base AS "OpenStreetMap" (${EOL}`;
  mapSyntax += `${TAB}url "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;
  return mapSyntax;
}

export function createLayerDeclarations(
  shapefileInfo,
  shapefilesFolder,
  manifest = null,
  rasterNames = null
) {
  let mapSyntax = ``;

  // layersByStaged keys exactly match sh.name (see manifest-util.js's
  // readProjectManifest / the plugin's naming.assign_staged_basenames) — a
  // missing manifest, or a staged entry the manifest doesn't know about (an
  // older plugin version, or a WMS/model/chart sidecar), falls through to
  // today's behaviour unchanged.
  const layersByStaged = manifest?.layersByStaged || {};

  const geometryColumn = ["geometry", "geom"];

  mapSyntax += shapefileInfo
    .map((sh) => {
      console.log(sh);
      let sentence = "";
      const isRaster = sh.type?.toLowerCase() === "geotiff";
      const isXyz = sh.type?.toLowerCase() === "xyz";
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
      } else if (isXyz) {
        const xyz = sh.xyz || {};
        const label =
          sanitizeDslText(layersByStaged[sh.name]?.title) || sh.name;
        const options = [];
        if (xyz.attribution) {
          options.push(`"attribution" "${dslAttribution(xyz.attribution)}"`);
        }
        if (xyz.zmin != null) options.push(`"minNativeZoom" "${xyz.zmin}"`);
        if (xyz.zmax != null) options.push(`"maxNativeZoom" "${xyz.zmax}"`);

        sentence +=
          `CREATE TILE LAYER ${dslLayerId(sh.name)} AS "${label}" (${EOL}` +
          `${TAB}url "${dslUrl(xyz.url)}"` +
          options.map((option) => `,${EOL}${TAB}${option}`).join("") +
          `${EOL});${EOL}${EOL}`;
        return sentence;
      } else if (isRaster) {
        const label =
          sanitizeDslText(layersByStaged[sh.name]?.title) || sh.name;
        const layerName = rasterNames?.get(sh.name);
        if (!layerName) {
          throw new Error(
            `No GeoServer layer name assigned to raster ${sh.name}`
          );
        }

        // Without an SLD, GeoServer's own default raster style applies: a
        // vector-style placeholder (the old random fill colour) meant nothing
        // to a coverage.
        if (sh.hasSld) {
          sentence +=
            `CREATE WMS STYLE ${lowerCamelCase(sh.name)}LayerStyle (${EOL}` +
            `${TAB}styleLayerDescriptor "${path.join(
              shapefilesFolder,
              sh.name + ".sld"
            )}"${EOL}` +
            `);${EOL}${EOL}`;
        }
        sentence +=
          `CREATE RASTER LAYER ${dslLayerId(sh.name)} AS "${label}" (${EOL}` +
          `${TAB}layerName "${layerName}"` +
          (sh.hasSld
            ? `,${EOL}${TAB}style ${lowerCamelCase(sh.name)}LayerStyle`
            : ``) +
          `${EOL});${EOL}${EOL}`;
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
          const geometry = CUSTOM_GEOM[geometryType] || geometryType;

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

  return mapSyntax;
}

/**
 * Builds one `CREATE SORTABLE MAP` block referencing layers that
 * createLayerDeclarations has *already* declared (for shapefileInfo itself,
 * or — when this is the "everything" overview map — for every directory's
 * shapefileInfo). Never declares an entity/style/layer itself: only a
 * reference by identifier, so calling this more than once for the same
 * layer (once for its own group's map, once more for the overview map) is
 * exactly as safe as it is for gp-gis-dsl's `CREATE SORTABLE MAP ... (
 * existingLayerId, ... )` — see createLayerDeclarations' docstring.
 */
export function createMapBlock(
  shapefileInfo,
  mapName,
  manifest = null,
  mapTitle = null
) {
  const layersByStaged = manifest?.layersByStaged || {};
  const resolvedMapTitle = sanitizeDslText(mapTitle) || mapName;

  let mapSyntax = ``;

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
  mapSyntax += `CREATE SORTABLE MAP ${mapName} AS "${resolvedMapTitle}" (${EOL}`;
  mapSyntax += `${TAB}base IS_BASE_LAYER,${EOL}`;
  mapSyntax += orderedEntries
    .map((entry) => `${TAB}${entry.id}${entry.hidden ? " HIDDEN" : ""}`)
    .join(`,${EOL}`);
  mapSyntax += `${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;

  return mapSyntax;
}
