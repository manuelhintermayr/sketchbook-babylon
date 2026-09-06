const webpack = require('webpack');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'production',
    plugins: [
        new webpack.BannerPlugin({
          banner:
          `Sketchbook 0.6 (https://github.com/manuelhintermayr/sketchbook-upgraded)\nBuilt on three.js (https://github.com/mrdoob/three.js) and cannon-es (https://github.com/pmndrs/cannon-es)`,
        }),
    ]
});