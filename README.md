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
4. [Examples](#examples)
5. [Development](#development)
6. [Changing the config.json](#changing-the-configjson)
   - [Local](#local)
   - [SSH](#ssh)
   - [AWS](#aws)
7. [Authors](#authors)
8. [License](#license)

## Installation

```bash
nvm use (optional, if you have nvm installed, otherwise just use node 19.x)
npm install
```

## Configuration

- Add a SPL folder with the code needed. If you don't have one, you can use the <https://github.com/lbdudc/mini-lps> source code as a template. After that change the `config.json` to set the SPL routes to the mini LPS. For example, add it in the root of this project and set the following:

```json
{
  "platform": {
    "codePath": "./lps/src/platform/code",
    "featureModel": "./lps/src/platform/model.xml",
    "config": "./lps/src/platform/config.json",
    "extraJS": "./lps/src/platform/extra.js",
    "modelTransformation": "./lps/src/platform/transformation.js"
  }
}
```

Also, if you can customize the features selected in your feature model adding a "features" key in the `config.json` file. For example:

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

## Examples

We provide some examples in the `examples` folder. You can use them to test the tool.

```bash
gispublisher examples/hello-world

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
npx gispublisher examples/hello-world
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
    "type": "local",
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
