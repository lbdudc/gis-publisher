import { upperCamelCase, lowerCamelCase } from "./str-util.js";

const TAB = "  ";
const EOL = "\n";

export function createBaseDSLInstance(name) {
  let str = `CREATE GIS ${name} USING 4326;${EOL}`;
  str += `USE GIS ${name};${EOL}${EOL}`;
  str += `SET DEPLOYMENT (${EOL}`;
  str += `  "client_deploy_url" "http://gis.lbd.org.es",${EOL}`;
  str += `  "geoserver_user" "admin",${EOL}`;
  str += `  "geoserver_password" "geoserver",${EOL}`;
  str += `  "server_deploy_url" "http://gis.lbd.org.es/backend",${EOL}`;
  str += `  "geoserver_url_wms" "http://gis.lbd.org.es/geoserver",${EOL}`;
  str += `  "server_deploy_port" "9001"${EOL}`;
  str += `);${EOL}${EOL}`;
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
    schemaSyntax += `${TAB}id Long IDENTIFIER`;

    // If there are more fields
    if (value.schema.length > 0) {
      schemaSyntax +=
        `,${EOL}` +
        value.schema
          .map((schema) => {
            if (schema.name == "id") {
              schema.name += "2";
            }
            return `${TAB}${lowerCamelCase(schema.name)} ${
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
