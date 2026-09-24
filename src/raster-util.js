/**
 * The GeoServer layer name of a raster (GeoTIFF). It is computed once per run
 * and then used verbatim everywhere — the DSL, the generated layers.json (client
 * and server), the coverage store GeoServer creates, and the importer's upload —
 * so no step ever has to re-derive it from the file name (which is what used to
 * make the client ask GeoServer for a layer that had been published under
 * another name).
 *
 * The `r_` prefix keeps a raster from ever colliding with a vector layer, which
 * GeoServer publishes as `t_<entity>`; the rest is a plain lowercase ASCII slug,
 * so it is safe in a REST URL and in a WMS `layers` parameter.
 */
export function rasterLayerName(stem, used = new Set()) {
  const slug = String(stem)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const base = `r_${slug || "raster"}`;
  let name = base;
  for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
  used.add(name);
  return name;
}

/**
 * Names every raster of every staged directory, in directory order, so two
 * rasters that slugify alike still end up with different names. Returns a Map
 * from the staged file name (without extension) to the GeoServer layer name.
 */
export function assignRasterNames(infoLists) {
  const used = new Set();
  const names = new Map();
  for (const list of infoLists) {
    for (const info of list) {
      if (info.type === "geoTIFF" && !names.has(info.name)) {
        names.set(info.name, rasterLayerName(info.name, used));
      }
    }
  }
  return names;
}
