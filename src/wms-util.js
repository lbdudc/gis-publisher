import fs from "fs";
import path from "path";

/**
 * Scopes the layers of the remote WMS services found in a staged folder down to the
 * sublayers that were actually picked.
 *
 * The QGIS plugin writes `urls.wms.json` next to `urls.wms`: one request per QGIS layer,
 * `{ url, layers: [...], styles: [...], crs, format }`. The file reader package only got
 * support for it in an unpublished version, and without it every sublayer the service
 * advertises is published: picking IGN's `fondo` layer also drew its `mosaico` layer (the
 * magenta mosaic outlines and flight dates) over the whole map. Doing it here works with
 * whichever reader version is installed.
 *
 * A service the sidecar doesn't cover, or a request that names no sublayer (the plugin
 * warns about that one), keeps everything the service advertises, as before.
 */
export function scopeWmsLayers(infos, dir) {
  const requests = readRequests(dir);
  if (!requests) return infos;

  return infos.map((info) => {
    if (info.type !== "wms" || !Array.isArray(info.schema)) return info;

    const layers = [];
    for (const url of new Set(info.schema.map((layer) => layer.url))) {
      const ofService = info.schema.filter((layer) => layer.url === url);
      const serviceRequests = requests.filter((r) => r.url === url);

      // nothing scopes this service: publish it whole
      if (
        serviceRequests.length === 0 ||
        serviceRequests.some((r) => !r.layers || r.layers.length === 0)
      ) {
        layers.push(...ofService);
        continue;
      }

      const picked = ofService.filter((layer) =>
        serviceRequests.some((r) => r.layers.includes(layer.layerName))
      );
      if (picked.length === 0) {
        console.warn(
          `None of the WMS layers picked from ${url} (${serviceRequests
            .flatMap((r) => r.layers)
            .join(", ")}) is in its capabilities; publishing the whole service.`
        );
        layers.push(...ofService);
        continue;
      }

      layers.push(
        ...picked.map((layer) => {
          const request = serviceRequests.find((r) =>
            r.layers.includes(layer.layerName)
          );
          return applyPickedStyle(layer, request);
        })
      );
    }
    return { ...info, schema: layers };
  });
}

/* the style picked in QGIS goes first: the DSL uses the first one of the layer */
function applyPickedStyle(layer, request) {
  const picked = request?.styles?.[request.layers.indexOf(layer.layerName)];
  const styles = Array.isArray(layer.styles) ? layer.styles : [];
  if (!picked || !styles.includes(picked)) return layer;
  return { ...layer, styles: [picked, ...styles.filter((s) => s !== picked)] };
}

function readRequests(dir) {
  const sidecar = path.join(dir, "urls.wms.json");
  if (!fs.existsSync(sidecar)) return null;
  try {
    const requests = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    return Array.isArray(requests) ? requests.filter((r) => r?.url) : null;
  } catch (e) {
    console.warn(
      `Ignoring invalid WMS scoping sidecar (${sidecar}): ${e.message}`
    );
    return null;
  }
}
