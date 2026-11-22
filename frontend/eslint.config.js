import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * Correctness-focused lint: hook rules, unreachable/duplicate code and TypeScript
 * hazards fail the build; stylistic preferences are left to the formatter.
 */
export default tseslint.config(
  { ignores: ["dist", "node_modules", "public", "playwright-report", "test-results"] },
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // TypeScript's noUnusedLocals already enforces this during the build.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
