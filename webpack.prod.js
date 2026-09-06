const webpack = require('webpack');
const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'production',
    plugins: [
        new webpack.BannerPlugin({
          banner:
          `Sketchbook 0.8 - Babylon.js edition (https://github.com/manuelhintermayr/sketchbook-babylon)\nBuilt on Babylon.js (https://github.com/BabylonJS/Babylon.js) and Havok Physics (https://www.npmjs.com/package/@babylonjs/havok)`,
        }),
    ]
});
