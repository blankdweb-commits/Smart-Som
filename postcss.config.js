// PostCSS pipeline. Tailwind v4 compiles/tree-shakes the used utilities; cssnano
// runs ONLY in production builds (Vite sets NODE_ENV=production) for maximum
// compression (removes comments, minifies values). Dev keeps unminified output
// for readable sourcemaps.
const plugins = {
  '@tailwindcss/postcss': {},
  'autoprefixer': {},
};

if (process.env.NODE_ENV === 'production') {
  plugins.cssnano = { preset: ['default', { discardComments: { removeAll: true } }] };
}

export default {
  plugins,
};