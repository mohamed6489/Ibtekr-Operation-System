// Rebuilds the prototype text from split()'s parts (see split-prototype.mjs), putting every tag back in place.
export function join(parts) {
  const scripts = parts.blocks.map((block, i) => (i > 0 ? parts.gaps[i - 1] : '') + '<script>' + block.code + '</script>');
  return parts.head + '<style>' + parts.baseCss + '</style>'
    + parts.headRest + '<style>' + parts.appCss + '</style>'
    + parts.rootDiv + scripts.join('') + parts.tail;
}
