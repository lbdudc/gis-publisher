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
7. [Changing the config.json](#changing-the-configjson)
   - [Local](#local)
   - [SSH](#ssh)
   - [AWS](#aws)
8. [Authors](#authors)
9. [License](#license)

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
gispublisher shapefilesFolder [--generate] [--config path] [--only-import] [--bbox bbox] [--help] [--version] [--debug]
```

### Arguments

- `shapefilesFolder`: Path to the folder containing the shapefiles to be published.

### Options

- `--generate, -g`: Just generate the product, do not deploy.
- `--config`: Path to config file (default config file if not used).
- `--only-import, -i`: Only import shapefiles.
- `--bbox`: Bounding box to restrict the search. Format is expected to be: `southwest_lng,southwest_lat,northeast_lng,northeast_lat`.
- `--help`: Print this info.
- `--version`: Print version.

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

## Changing the config.json

### Local

- Pre-requisites:
  Have docker and docker-compose installed

```json
{
  "deploy": {
    "type": "local"
  },
  "host": "http://localhost:80"
}
```

### SSH

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

## Authors

| Name               | Email                       |
| ------------------ | --------------------------- |
| Victor Lamas       | <victor.lamas@udc.es>       |
| David De Castro    | <david.decastro@udc.es>     |
| Alejandro Cortiñas | <alejandro.cortinas@udc.es> |

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details
