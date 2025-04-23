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
        { prefer: "type-imports" }
      ],
      // Enforce explicit return types on functions and class methods
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true }
      ],
      // Enforce consistent usage of type imports
      "@typescript-eslint/no-import-type-side-effects": "error",
      // Disallow unused variables
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Enforce consistent React imports
      "react/react-in-jsx-scope": "off",
      // Enforce hook dependencies
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default eslintConfig;
