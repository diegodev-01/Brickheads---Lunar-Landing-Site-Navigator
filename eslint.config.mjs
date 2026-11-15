import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // Architecture boundary: the domain layer is pure TypeScript (see docs/architecture.md).
    files: ["src/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*"],
              message: "domain/ must not depend on React.",
            },
            { group: ["next", "next/*"], message: "domain/ must not depend on Next.js." },
            { group: ["ol", "ol/*"], message: "domain/ must not depend on the map library." },
            {
              group: ["@/app/*", "@/features/*", "@/data/*", "@/components/*"],
              message: "domain/ must not import from outer layers.",
            },
          ],
        },
      ],
    },
  },
  {
    // Data adapters may use domain types but never UI code.
    files: ["src/data/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/app/*", "@/features/*", "@/components/*"],
              message: "data/ must not import UI code.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "scripts/.venv/**"]),
]);

export default eslintConfig;
