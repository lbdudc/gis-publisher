/**
 * Generate random color based on string, if isStroke is true, the color will be darker
 * @param {String} string String to generate color from
 * @param {Boolean} isStroke If true, the color will be darker
 * @returns {String} Hex color string in format #RRGGBB
 */
export const generateRandomHexColor = (string, isStroke = false) => {
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    hash = string.charCodeAt(i) + ((hash << 5) - hash);
  }

  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).substr(-2);
  }

  return isStroke ? shadeColor(color, -0.3) : color;
};

/**
 * Shade a color based on percentage value
 * @param {String} color Hex color string in format #RRGGBB
 * @param {Double} percent Percentage value to shade
 * @returns {String} Hex color string in format #RRGGBB
 */
const shadeColor = (color, percent) => {
  const f = parseInt(color.slice(1), 16);
  const t = percent < 0 ? 0 : 255;
  const p = percent < 0 ? percent * -1 : percent;
  const R = f >> 16;
  const G = (f >> 8) & 0x00ff;
  const B = f & 0x0000ff;
  return `#${(
    0x1000000 +
    (Math.round((t - R) * p) + R) * 0x10000 +
    (Math.round((t - G) * p) + G) * 0x100 +
    (Math.round((t - B) * p) + B)
  )
    .toString(16)
    .slice(1)}`;
};
