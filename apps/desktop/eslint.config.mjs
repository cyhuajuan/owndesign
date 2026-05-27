import config from "../../packages/config/eslint.config.mjs";

export default [
  {
    ignores: ["src-tauri/resources/**", "src-tauri/target/**", "dist/**"],
  },
  ...config,
];
