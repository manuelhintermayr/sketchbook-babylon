const path = require('path');
const webpack = require('webpack');

module.exports = {
    plugins: [
        // Babylon lazy-loads shader modules through dynamic import(); fold
        // those async chunks back into the single UMD bundle so
        // build/sketchbook.min.js stays the one file index.html and
        // tools/build-static.js know about.
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    ],
    entry: {
        app: './src/ts/sketchbook.ts'
    },
    output: {
        filename: './build/sketchbook.min.js',
        library: 'Sketchbook',
        libraryTarget: 'umd',
        path: path.resolve(__dirname),
        // Asset URLs (the Havok .wasm) resolve relative to index.html, not
        // to the bundle's own build/ folder.
        publicPath: ''
    },
    resolve: {
        extensions: [ '.tsx', '.ts', '.js' ],
    },
    module: {
        rules: [
        {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/,
        },
        {
            test: /\.css$/,
            use: [
                { loader: 'style-loader', options: { injectType: 'singletonStyleTag' } },
                { loader: 'css-loader' },
            ]
        },
        {
            // Havok ships its physics core as a WebAssembly binary that the
            // Emscripten loader fetches at runtime. Emit it next to the bundle
            // as a plain file (no wasm-module parsing) - PhysicsBoot.ts points
            // Emscripten's locateFile at exactly this path.
            test: /\.wasm$/,
            type: 'asset/resource',
            generator: {
                filename: 'build/HavokPhysics.wasm',
            },
        }
      ]
    },
    performance: {
        hints: false
    }
};
