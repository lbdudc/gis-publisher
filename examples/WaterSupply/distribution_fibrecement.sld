<?xml version="1.0"?>
<StyledLayerDescriptor version="1.0.0"    
    xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd"
	xmlns="http://www.opengis.net/sld"
	xmlns:ogc="http://www.opengis.net/ogc"
	xmlns:xlink="http://www.w3.org/1999/xlink"
	xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
	<NamedLayer>
		<Name>webeiel:t_valores_indices</Name>
		<UserStyle>
			<IsDefault>1</IsDefault>
      <FeatureTypeStyle>
        <Rule>
        <MinScaleDenominator>24000</MinScaleDenominator>
          <PolygonSymbolizer>
            <Geometry>
              <ogc:PropertyName>geometria</ogc:PropertyName>
            </Geometry>
            <Fill>
              <CssParameter name="fill">#ffffff</CssParameter>
              <CssParameter name="fill-opacity">0.7</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">#232323</CssParameter>
              <CssParameter name="stroke-width">1</CssParameter>
              <CssParameter name="stroke-linejoin">bevel</CssParameter>
			  <CssParameter name="stroke-dasharray">5 3</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
        <Rule>
        <MaxScaleDenominator>24000</MaxScaleDenominator>
          <PolygonSymbolizer>
            <Geometry>
              <ogc:PropertyName>geometria</ogc:PropertyName>
            </Geometry>
            <Fill>
              <CssParameter name="fill">#ffffff</CssParameter>
              <CssParameter name="fill-opacity">0.3</CssParameter>
            </Fill>
            <Stroke>
              <CssParameter name="stroke">#232323</CssParameter>
              <CssParameter name="stroke-width">1</CssParameter>
              <CssParameter name="stroke-linejoin">bevel</CssParameter>
			  <CssParameter name="stroke-dasharray">5 3</CssParameter>
            </Stroke>
          </PolygonSymbolizer>
        </Rule>
      </FeatureTypeStyle>
		</UserStyle>
	</NamedLayer>
</StyledLayerDescriptor>
