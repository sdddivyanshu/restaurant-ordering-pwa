import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Menu images are local SVG/uploaded files served through our own route; next/image adds little here.
      "@next/next/no-img-element": "off",
      // Our effects that set state synchronise from external systems (localStorage hydration,
      // fetch-on-mount, navigator.onLine). Kept visible as a warning rather than an error.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "lib/generated/**",
    "playwright-report/**",
    "test-results/**",
    "public/sw.js",
  ]),
]);
