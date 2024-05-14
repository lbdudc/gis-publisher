import { upperCamelCase, lowerCamelCase } from "./str-util.js";
import { generateRandomHexColor } from "./color-util.js";

const TAB = "  ";
const EOL = "\n";

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
    str += `  "geoserver_password" "geoserver",${EOL}`;
    str += `  "geoserver_url_wms" "http://localhost:8080/geoserver"${EOL}`;
    str += `);${EOL}${EOL}`;
  }

  return str;
}

export function endDSLInstance(name) {
  return `GENERATE GIS ${name};${EOL}`;
}

export const createEntityScheme = (values) => {
  let schemaSyntax = ``;

  const TYPES_REL = {
    Number: "Long",
    String: "String",
  };

  values.forEach((value) => {
    schemaSyntax += `CREATE ENTITY ${upperCamelCase(value.name)} (${EOL}`;

    // Add the id field, which is the first one
    schemaSyntax += `${TAB}id Long IDENTIFIER DISPLAY_STRING`;

    // If there are more fields
    if (value.schema.length > 0) {
      schemaSyntax +=
        `,${EOL}` +
        value.schema
          .map((schema) => {
            if (schema.name == "id") {
              schema.name += "2";
            }
            return `${TAB}${schema.name.toLowerCase()} ${
              TYPES_REL[schema.type] || schema.type
            }`;
          })
          .join(`,${EOL}`) +
        `${EOL}`;
    }

    schemaSyntax += `);${EOL}${EOL}`;
  });

  return schemaSyntax;
};

export function createMapFromEntity(shapefileInfo, shapefilesFolder) {
  let mapSyntax = ``;

  const GEOM_TYPES = {
    Polygon: "Polygon",
    LineString: "LineString",
    Point: "Point",
    MultiPolygon: "Polygon",
    MultiLineString: "LineString",
    MultiPoint: "Point",
  };

  mapSyntax += `CREATE TILE LAYER base AS "OpenStreetMap" (${EOL}`;
  mapSyntax += `${TAB}url "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;

  mapSyntax += shapefileInfo
    .map((sh) => {
      console.log(sh);
      let sentence = "";
      const geometryType = sh.schema.find((s) => s.name === "geometry").type;

      if (sh.hasSld) {
        sentence +=
          `CREATE WMS STYLE ${lowerCamelCase(sh.name)}LayerStyle (${EOL}` +
          `${TAB}styleLayerDescriptor "${shapefilesFolder}${sh.name}.sld"${EOL}` +
          `);${EOL}${EOL}`;
      } else {
        sentence +=
          `CREATE WMS STYLE ${lowerCamelCase(sh.name)}LayerStyle (${EOL}` +
          `${TAB}geometryType ${
            GEOM_TYPES[geometryType].toUpperCase() || "Geometry"
          },${EOL}` +
          `${TAB}fillColor ${generateRandomHexColor(sh.name)},${EOL}` +
          `${TAB}strokeColor ${generateRandomHexColor(sh.name, true)},${EOL}` +
          `${TAB}fillOpacity 0.7,${EOL}` +
          `${TAB}strokeOpacity 1${EOL}` +
          `);${EOL}${EOL}`;
      }
      sentence +=
        `CREATE WMS LAYER ${lowerCamelCase(sh.name)}Layer AS "${
          sh.name
        }" (${EOL}` +
        `${TAB}${upperCamelCase(sh.name)} ${lowerCamelCase(
          sh.name
        )}LayerStyle${EOL}` +
        `);${EOL}${EOL}`;

      return sentence;
    })
    .join(EOL);

  mapSyntax += `CREATE MAP main AS "Map" (${EOL}`;
  mapSyntax += `${TAB}base IS_BASE_LAYER,${EOL}`;
  mapSyntax += shapefileInfo
    .map((sh) => {
      return `${TAB}${lowerCamelCase(sh.name)}Layer`;
    })
    .join(`,${EOL}`);
  mapSyntax += `${EOL}`;
  mapSyntax += `);${EOL}${EOL}`;

  return mapSyntax;
}
