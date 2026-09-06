// ESLint flat config for Sketchbook.
//
// Replaces the old tslint.json. The project's existing style (tabs, single
// quotes, no strict TypeScript) is preserved - this config enforces the same
// minimal rules the old tslint.json did, plus a few that catch real bugs.
// It is intentionally NOT set up with @typescript-eslint type-aware rules,
// because the codebase is not yet strict-typed and enabling them would
// produce hundreds of warnings unrelated to this migration.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: [
			'build/**',
			'node_modules/**',
			'src/lib/**',
			'src/ts/declarations.d.ts',
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ['src/ts/**/*.ts'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				window: 'readonly',
				document: 'readonly',
				navigator: 'readonly',
				performance: 'readonly',
				requestAnimationFrame: 'readonly',
				console: 'readonly',
			},
		},
		rules: {
			// Style (formerly enforced by tslint.json)
			'indent': ['error', 'tab', { SwitchCase: 1 }],
			'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],

			// Explicitly disabled in the legacy tslint.json
			'prefer-const': 'off',

			// The codebase uses many implicit-any patterns and unused placeholder
			// parameters (state machine callbacks, Three.js traversal). Turning
			// these off keeps lint actionable rather than drowning it in noise.
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-vars': 'off',
			'@typescript-eslint/no-empty-function': 'off',
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unused-expressions': 'off',
			'@typescript-eslint/no-this-alias': 'off',
			'@typescript-eslint/no-namespace': 'off',
			'no-empty': 'off',
			'no-inner-declarations': 'off',
			'no-prototype-builtins': 'off',
			'no-case-declarations': 'off',
		},
	},
);
