// @ts-check
import tseslint from "typescript-eslint";

/**
 * The engine must stay pure: no UI, network, database, clock, filesystem,
 * or unseeded randomness (CLAUDE.md "Stack"). These rules make that a
 * lint failure rather than a code-review convention.
 */
const ENGINE_FORBIDDEN_IMPORTS = [
  "react",
  "react-dom",
  "next",
  "@supabase/supabase-js",
  "fs",
  "node:fs",
  "path",
  "node:path",
  "http",
  "node:http",
  "https",
  "node:https",
  "net",
  "node:net",
  "crypto",
  "node:crypto",
  "child_process",
  "node:child_process",
];

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["packages/engine/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ENGINE_FORBIDDEN_IMPORTS.map((name) => ({ name, message: "The engine is pure: no host or framework imports." })),
          patterns: [
            { group: ["react*", "next/*", "@supabase/*", "node:*", "fs/*", "path/*"], message: "The engine is pure: no host or framework imports." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The engine never reads the clock." },
        { name: "fetch", message: "The engine never touches the network." },
        { name: "window", message: "The engine has no DOM." },
        { name: "document", message: "The engine has no DOM." },
        { name: "localStorage", message: "The engine has no DOM." },
        { name: "process", message: "The engine has no host access." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded rng (docs/rules.md §12)." },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: ["**/*.test.ts", "packages/engine/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
