import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "dist/", "test-results/", "playwright-report/", "src/api/generated.ts"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs["recommended-latest"],
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      // TypeScript checks names; the plain JS files are browser and Node scripts.
      "no-undef": "off",
      // Text sanitising matches control characters on purpose.
      "no-control-regex": "off",
      // Untyped test doubles and API payloads; not part of this gate yet.
      "@typescript-eslint/no-explicit-any": "off",
      // A leading underscore marks a deliberately unused name.
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
    },
  },
);
