# GisPublisher

<div style="display:flex; margin-bottom: 20px;">
  <img src="https://img.shields.io/npm/v/@lbdudc/gis-publisher?&style=flat-square" alt="npm version">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?&style=flat-square" alt="License: MIT">
  <img src="https://img.shields.io/node/v/@lbdudc/gis-publisher?&style=flat-square" alt="Node.js Version">
</div>

Tool designed to simplify the creation of web-based Geographic Information Systems (GIS) from a collection of shapefiles. With optional support for OGC Web Coverage Service (WCS), it simplifies the process of generating interactive GIS platforms, allowing users to visualize and analyze spatial data efficiently.

## Table of Contents

1. [Installation](#installation)
2. [Configuration](#configuration)
3. [Usage](#usage)
   - [Arguments](#arguments)
   - [Options](#options)
4. [Data Visualizations with Vega](#charts)
5. [Examples](#examples)
6. [Development](#development)
7. [Command line](#command-line)
8. [Changing the config.json](#changing-the-configjson)
   - [Local](#local)
   - [SSH](#ssh)
   - [HTTPS with your own domain](#https-with-your-own-domain-ssh-aws)
   - [Generate as a zip](#generate-as-a-zip)
   - [AWS](#aws)
   - [Hetzner Cloud and DigitalOcean](#hetzner-cloud-and-digitalocean)
9. [Authors](#authors)
10. [License](#license)

## Installation

```bash
nvm use (optional, if you have nvm installed, otherwise just use node 19.x)
npm install
```

## Configuration

You can customize the features selected in your feature model adding a "features" key in the `config.json` file. For example:

```json
{
  ...
  "features": [
    "feature1",
    "feature2"
  ],
}
```

- Change the `config.json` file to match your needs. Choosing the type of deployment (local, ssh or aws) and the necessary parameters for each one. You can find more information about the configuration in the [Changing the config.json](#changing-the-configjson) section.

- Add your shapefiles in a folder. The tool accepts shapefiles with the following extensions: `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg` and `.sld`. Also accepts `.zip` files containing the shapefiles.

!WARNING!: The geometries must be in EPSG:4326 projection!, and the geometries of Polygon and LineString must be MultiPolygon and MultiLineString respectively.

## Usage

```bash
gispublisher shapefilesFolder [options]
```

The options below are the general ones; what to deploy and where (`--type`, `--host`, `--domain`...) is described in [Command line](#command-line), and `gispublisher --help` lists everything.

### Arguments

- `shapefilesFolder`: Path to the folder containing the shapefiles to be published.

### Options

- `--generate, -g`: Just generate the product, do not deploy.
- `--config`: Path to a configuration file. It only has to say what differs from the defaults; the deploy options of [Command line](#command-line) override it.
- `--only-import, -i`: Only import shapefiles.
- `--bbox`: Bounding box to restrict the search. Format is expected to be: `southwest_lng,southwest_lat,northeast_lng,northeast_lat`.
- `--progress <text|json>`: How progress is reported. `text` (default) prints readable lines such as `[5/8] Upload code - done (8s)`. `json` prints one `@@gp {...}` line per event (`plan`, `step`, `services`, `log`, `result`, `error`) for programs that show their own UI, such as the QGIS plugin; see `src/progress.js` for the event shapes.
- `--help`: Print this info.
- `--version`: Print version.

A deployment ends when every service of the generated stack is healthy (one-shot services such as the data importer must have exited successfully), and the app's URL is reported as the result. The data is loaded by the stack's own `data-importer` service; `--only-import` is only needed to load data into an already running app.

## Data Visualizations with Vega

GisPublisher allows including data visualizations by defining a `charts` folder in the project structure.
Charts are described using **[Vega](https://vega.github.io/vega/)** specifications and are automatically integrated into the generated product.

There are two approaches to add charts in your project: by adding them manually or by creating them in the Chart Explorer within the UI.

### Adding charts manually

To add charts manually, create a `charts` directory inside the shapefiles folder passed to gispublisher, for example:

```
shapefilesFolder/charts
                  ├─ /chart1.json
                  ├─ /chart2.json
```

Each `.json` file must contain a valid Vega or Vega-Lite specification.

Charts can be defined in two different ways:

**a) Standard Vega Charts**

You can include any standard Vega or Vega-Lite specification that uses static data or external data sources.

**b) Charts using generated entities**

Charts can also use the entities generated from the shapefiles during the product generation. In this case, the data source should point to the following endpoint: `/api/entities/<entity>/export/tsv`.

The chart specification must define the data source URL and indicate which fields from that entity will be used as the X and Y axes.

You can see an example of a valid chart specification by exporting a chart from the Chart Explorer in the UI, which provides a JSON in the correct format.

Once the charts are added, generating the product with GisPublisher will automatically include a Data Visualizations section in the output. These charts will appear in the Chart Viewer under the My Charts tab, where they can be viewed and explored.

### Using the Chart Explorer

In the Chart Viewer, there is another tab called Explorer, where you can create and customize your own charts. You can select:

- The entity to visualize
- The fields for the X and Y axes
- The chart type (e.g., line, bar)

Once you’ve designed a chart, you can export it. To save it in the My Charts section, move the `.json` file to the `shapefilesFolder/charts` directory. The next time you generate the product with GisPublisher, these charts will automatically appear in My Charts.

## Examples

We provide some examples in the `examples` folder. You can use them to test the tool.

```bash
gispublisher examples/hello_world

gispublisher examples/WaterSupply
```

## Development

```bash
# if nvm installed, otherwise just use node 19.x
nvm use

npm install

# to set husky git hooks (linting)
npm run prepare

# to run, first update config.json and then:
npx gispublisher args

# for example
npx gispublisher examples/hello_world
```

## Command line

Everything the QGIS plugin can do with a deployment is available from the command line: the plugin only writes a small configuration file and calls this same command. The folder you give is a folder of shapefiles (with an optional `.sld` style next to each), rasters, `.tiles.json`/`.wms` files, and optionally a `qgis-project.json` with names, order, colours, branding and editable layers.

```sh
gispublisher <folder> [options]
```

| Option                                                                                                                                                 | What it does                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--generate`, `-g`                                                                                                                                     | Only generate the app (in `./output`), do not deploy it                                                                                                                                             |
| `--name`, `--app-version`                                                                                                                              | Name (a plain identifier) and version of the app                                                                                                                                                    |
| `--type`                                                                                                                                               | `local` (default), `ssh`, `aws`, `hetzner` or `digitalocean`                                                                                                                                        |
| `--server-name`, `--server-size`, `--server-region`, `--server-image`                                                                                  | The server to create at Hetzner Cloud / DigitalOcean (found again by its name; `--key` is its ssh key). The token comes from `HCLOUD_TOKEN` / `DIGITALOCEAN_TOKEN`, never from an option            |
| `--host`                                                                                                                                               | ssh/aws: the server; local: the URL the app is opened at                                                                                                                                            |
| `--port`, `--user`, `--key`, `--remote-path`                                                                                                           | ssh port, user, private key file, and the absolute folder on the server (emptied on every deploy, at least two levels deep)                                                                         |
| `--domain`, `--acme-email`                                                                                                                             | Serve the app over HTTPS at that name with a free Let's Encrypt certificate (see [HTTPS](#https-with-your-own-domain-ssh-aws))                                                                      |
| `--internal-certificate`                                                                                                                               | With a domain: a certificate made by the stack itself, for names only your own network knows                                                                                                        |
| `--zip`, `--zip-file`                                                                                                                                  | With `--generate`: also save the app as a zip to run anywhere with Docker (see [Generate as a zip](#generate-as-a-zip)); `--zip-file` says where (default `<name>-<version>.zip`)                   |
| `--reset-data`                                                                                                                                         | Start from an empty database (a redeploy keeps it otherwise)                                                                                                                                        |
| `--update-data`                                                                                                                                        | Reload only the data of an app that is already deployed                                                                                                                                             |
| `--aws-region`, `--aws-ami`, `--aws-instance-type`, `--aws-instance-name`, `--aws-security-group`, `--aws-key-name`, `--aws-user`, `--aws-remote-path` | The AWS instance to create (`--key` is its ssh key; `--host` uses one that already exists). The keys come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` or `AWS_PROFILE`, never from an option |
| `--config <file>`                                                                                                                                      | A JSON configuration; it only has to say what differs from the defaults, and the options above override it                                                                                          |
| `--set key=value`                                                                                                                                      | Any other setting by its path, as many times as needed (`--set deploy.overwriteEditedLayers=true`)                                                                                                  |
| `--progress json`                                                                                                                                      | One `@@gp {...}` event per line, for programs                                                                                                                                                       |

Examples:

```sh
# over ssh, HTTPS at your domain
gispublisher ./layers --name demo --type ssh --host 203.0.113.5 --user ubuntu \
  --key ~/.ssh/id.pem --remote-path /home/ubuntu/demo \
  --domain gis.example.org --acme-email you@example.org

# a zip for someone else to run anywhere with Docker
gispublisher ./layers --name demo --generate --zip-file ./demo-1.0.0.zip

# on this machine, only generating
gispublisher ./layers --name demo --generate
```

What is missing or wrong (a domain that is not a name, an ssh deployment without a key, an unsafe remote folder...) is reported before anything is generated or built, and the command exits with status 2. The result of a run is printed as `Application available at <url>` or `Zip saved to <file>`; a generated editing password is printed too. On Windows Git Bash rewrites arguments that look like paths (`--remote-path /home/ubuntu/app`): use PowerShell, or set `MSYS_NO_PATHCONV=1`.

## Changing the config.json

### Local

- Pre-requisites:
  Have Docker (with the compose plugin) installed and running

```json
{
  "deploy": {
    "type": "local"
  },
  "host": "http://localhost:80"
}
```

### SSH

Needs an `ssh`/`scp` client on this machine and key based authentication (no password prompts). Docker is installed on the server the first time, which needs a user with passwordless `sudo`. `remoteRepoPath` must be an absolute folder at least two levels deep: it is emptied on every deploy.

```json
{
  "deploy": {
    "type": "ssh",
    "host": "your-remote-host.com or IP",
    "port": 22222,
    "username": "username",
    "certRoute": "/path/to/your/cert.pem",
    "remoteRepoPath": "/path/to/remote/repo/code"
  },
  "host": "your-remote-host.com or IP"
}
```

### HTTPS with your own domain (ssh, aws)

Add `domain` to the `deploy` section to serve the app over HTTPS at that name. A Caddy service is added to the stack: it gets a free Let's Encrypt certificate and renews it by itself.

```json
"deploy": {
  "type": "ssh",
  "domain": "gis.example.org",
  "acmeEmail": "you@example.org"
}
```

- The domain must already point at the server (an A record) and ports 80 and 443 must be open. Before anything is built, the deployment checks that the name leads to the server and stops with a clear message if it does not (for a server that AWS creates during the deployment, which has no address yet, this is only a warning: the certificate is issued as soon as the name points at it). For AWS it also checks that the security group opens 80 and 443.
- `acmeEmail` is optional (Let's Encrypt sends expiry notices to it).
- The certificates are kept in `/var/lib/gispublisher/<app>/caddy` on the server, outside the deployment folder, so a redeploy (which empties that folder) does not ask Let's Encrypt for a new one.
- `"internalCertificate": true` makes Caddy use a certificate of its own instead of Let's Encrypt: for a name only your own network knows, and to try the whole thing out (`"domain": "gp.localhost"` also works with a `local` deployment).

Without a domain the app is served over plain http at the server's address. Do not give people an editing password over plain http on the internet.

### What a deployment to another machine does for security (ssh, aws)

- No service port is published on the server except nginx's (or Caddy's): the database, GeoServer, the API and the QGIS services are only reachable inside the compose network.
- The database and GeoServer get random passwords made for this deployment, kept next to it in `.gp-deploy-secrets.json` (not uploaded). An app deployed by an earlier version keeps its defaults.
- nginx does not serve GeoServer's administration pages or REST API.
- The app's proxy (`/backend/api/proxy`) only calls the stack's own QGIS services and public servers; internal, loopback, link-local and private addresses are refused.

### Live PostGIS / WFS layers

A layer can stay _live_: the app's own GeoServer connects to a PostGIS table or a WFS layer and draws it, so nothing is copied into the app's database (and there is no list, search, download or editing for it). Put a `<name>.live.json` next to the shapefiles of the folder (and a `<name>.sld` for its style if wanted):

```json
{"kind": "postgis", "host": "db.example.org", "port": 5432, "database": "gis", "schema": "public",
 "table": "towns", "user": "reader", "password": "...", "srid": 4326}
{"kind": "wfs", "url": "https://example.org/geoserver/wfs", "typeName": "ns:towns", "user": "", "password": "", "srid": 4326}
```

A source on the machine that runs the app (`localhost`) is reached as `host.docker.internal`. The connection (and its password) goes only to the server's GeoServer setup, not to the client. A sidecar that is unusable is skipped with a warning.

### Generate as a zip

Generating can also end in a zip, so that whoever receives it can run the app on any machine with Docker. Nothing is deployed, and it is an option of `--generate`, not a deployment target:

```sh
gispublisher ./layers --name demo --generate --zip
gispublisher ./layers --name demo --generate --zip-file ./demo-1.0.0.zip
```

or in the configuration file: `{"zip": true, "zipFile": "/path/to/my-app-1.0.0.zip"}`. The zip is `<name>-<version>.zip` in the current folder unless `zipFile` says otherwise. It holds the app, a `README.md` and `start.sh` / `start.ps1`; the result is the path of the zip, not a URL. The scripts start the stack (`./start.sh`), and with `--domain gis.example.org` (`-Domain` on Windows) also the HTTPS front; `--internal-cert` makes Caddy use its own certificate for names only your network knows. The app made for a zip is the portable flavour of the product, with its own random passwords (kept in `.gp-package-secrets.json` next to the config, and inside the zip, which should therefore stay private).

### AWS

```json
"deploy": {
    "type": "aws",
    "AWS_ACCESS_KEY_ID": "AKIAJY2Q...",
    "AWS_SECRET_ACCESS_KEY": "X8Y4X0...",
    "AWS_REGION": "eu-west-2",
    "AWS_AMI_ID": "ami-08b064b1296caf3b2",
    "AWS_INSTANCE_TYPE": "t2.micro",
    "AWS_INSTANCE_NAME": "my-aws-instance",
    "AWS_SECURITY_GROUP_ID": "sg-0a1b2c3d4e5f6a7b8",
    "AWS_KEY_NAME": "mykey",
    "AWS_USERNAME": "ec2-user",
    "AWS_SSH_PRIVATE_KEY_PATH": "user/.ssh/mykey.pem",
    "REMOTE_REPO_PATH": "/home/ec2-user/code"
}
```

### Hetzner Cloud and DigitalOcean

The deployment creates a server at the provider on the first deploy (Ubuntu, Docker installed for you, a firewall for ports 22, 80 and 443, your public ssh key added to the account) and finds it again by its name on the next ones, so a redeploy keeps the server and its data. From the command line:

```sh
export HCLOUD_TOKEN=...            # or DIGITALOCEAN_TOKEN=... (never an option or a file)
gispublisher ./layers --name demo --type hetzner --server-name demo-app --key ~/.ssh/id_ed25519
gispublisher ./layers --name demo --type digitalocean --server-name demo-app --key ~/.ssh/id_ed25519 \
  --server-size s-4vcpu-8gb --server-region ams3 --domain gis.example.org
```

`--key` is the private key; the public half (`<key>.pub`) must be next to it. `--server-size` (default `cx22` / `s-2vcpu-4gb`, 4 GB: the build needs that much), `--server-region` (`fsn1` / `fra1`) and `--server-image` are optional. The user is `root` and the app goes to `/root/gispublisher-app`. `--host` deploys to a server that already exists instead. With `--domain`, the name can only point at the server once it exists, so the certificate is issued as soon as you point the name at it. In a configuration file: `{"deploy": {"type": "hetzner", "serverName": "demo-app", "serverSize": "cx32", "certRoute": "/home/me/.ssh/id_ed25519"}}` (the token still comes from the environment). **These two providers have not been tried against the real services** (an account with a payment method is needed): the flow is tested against a fake API, and a wrong token is refused by the real APIs with a clear message.

## Authors

| Name               | Email                       |
| ------------------ | --------------------------- |
| Victor Lamas       | <victor.lamas@udc.es>       |
| David De Castro    | <david.decastro@udc.es>     |
| Alejandro Cortiñas | <alejandro.cortinas@udc.es> |

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
