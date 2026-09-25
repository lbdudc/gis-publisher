/**
 * Web-app options and branding the QGIS plugin writes into qgis-project.json
 * (`project.options`, `project.branding`; see qgispublisher-plugin/core/web_options.py).
 * Everything here is pure, and a missing manifest or key means "the default", so
 * projects staged by an older plugin generate exactly what they used to.
 */

export const DEFAULT_OPTIONS = {
  search: true,
  geocoder: false,
  legend: true,
  downloads: true,
};

// Features each option switches on. `legend` is also in gisdsl's default list, so
// turning it off has to remove it as well as not add it.
const OPTION_FEATURES = {
  search: ["MV_T_Filterable", "MV_T_F_BasicSearch"],
  geocoder: ["MV_T_F_Geocoder"],
  legend: ["MV_T_E_ShowLegend"],
  downloads: ["DM_DataExport"],
};

const isBool = (v) => typeof v === "boolean";

/** The options of the manifest, each falling back to its default. */
export function appOptionsFromManifest(manifest) {
  const given = manifest?.project?.options || {};
  const options = {};
  for (const [key, fallback] of Object.entries(DEFAULT_OPTIONS)) {
    options[key] = isBool(given[key]) ? given[key] : fallback;
  }
  return options;
}

/** `features` with every option's features added (option on) or removed (off). */
export function applyFeatureOptions(features, options) {
  const result = new Set(features || []);
  for (const [option, names] of Object.entries(OPTION_FEATURES)) {
    for (const name of names) {
      if (options[option]) result.add(name);
      else result.delete(name);
    }
  }
  return [...result];
}

export const DEFAULT_BASEMAP = "osm";

// url/attribution/subdomains/maxZoom are DSL tile options (gisdsl's TILE_OPTIONS)
export const BASEMAPS = {
  osm: {
    label: "OpenStreetMap",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxNativeZoom: 19,
  },
  "esri-light": {
    label: "Light gray (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxNativeZoom: 16,
  },
  "esri-dark": {
    label: "Dark gray (Esri)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxNativeZoom: 16,
  },
  "esri-imagery": {
    label: "Esri World Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles © Esri",
    maxNativeZoom: 19,
  },
  opentopo: {
    label: "OpenTopoMap",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
    subdomains: "abc",
    maxNativeZoom: 17,
  },
};

/** The catalogue entry for the manifest's basemap id (the default for an unknown one). */
export function basemapFromManifest(manifest) {
  const id = manifest?.project?.branding?.basemap;
  return BASEMAPS[id] || BASEMAPS[DEFAULT_BASEMAP];
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
// Any extension the app's <img> can show; the plugin stages it as `logo.<ext>`
export const LOGO_EXTENSIONS = ["png", "jpg", "jpeg", "svg", "webp"];

/**
 * What the generated app shows as its own: `{ title, primaryColor, logo }`, each
 * only when it is set and valid. `logo` is the file name inside `branding/`.
 */
export function brandingFromManifest(manifest) {
  const given = manifest?.project?.branding || {};
  const branding = {};
  const title = String(given.title ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (title) branding.title = title;
  if (HEX_COLOR.test(given.primaryColor || "")) {
    branding.primaryColor = given.primaryColor;
  }
  const logo = String(given.logo || "");
  const extension = logo.split(".").pop().toLowerCase();
  if (/^[A-Za-z0-9._-]+$/.test(logo) && LOGO_EXTENSIONS.includes(extension)) {
    branding.logo = logo;
  }
  return branding;
}

/**
 * Sets what the generated app reads from `basicData.extra` (mini-lps's
 * getExtraConfigFromSpec): `app_title`, `primary_color`, `logo`. `name` is left
 * alone, it becomes identifiers (package, containers, artifact).
 */
export function applyBrandingToSpec(json, manifest, { logoUrl } = {}) {
  const branding = brandingFromManifest(manifest);
  const extra = { ...json.basicData?.extra };
  if (branding.title) extra.app_title = branding.title;
  if (branding.primaryColor) extra.primary_color = branding.primaryColor;
  if (branding.logo && logoUrl) extra.logo = logoUrl;
  json.basicData = { ...json.basicData, extra };
  return json;
}
