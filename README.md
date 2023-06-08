# gisbuilder2

Tool to automatically generate a web-based GIS from a set of shapefiles and, optionally, from a OGC WCS.

## Development

```bash
# if nvm installed, otherwise just use node 19.x
nvm use

npm install

# to set husky git hooks (linting)
npm run prepare

# to run, first update config.json and then:
npx gisbuilder2 args

# for example
npx gisbuilder2 examples/hello-world
```
