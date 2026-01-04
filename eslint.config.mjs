import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends(
    "next/core-web-vitals",
    "next/typescript",
    "plugin:@typescript-eslint/recommended"
  ),
  {
    rules: {
      // Enforce type imports
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" }
      ],
      // Explicit return types - disabled for React components (too verbose)
      "@typescript-eslint/explicit-function-return-type": "off",
      // Enforce consistent usage of type imports
      "@typescript-eslint/no-import-type-side-effects": "error",
      // Disallow unused variables - prefix with _ to ignore
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      // Disallow explicit any - warn instead of error for gradual migration
      "@typescript-eslint/no-explicit-any": "warn",
      // Enforce consistent React imports
      "react/react-in-jsx-scope": "off",
      // Enforce hook dependencies
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
