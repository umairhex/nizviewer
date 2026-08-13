import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        browser: "readonly",
        chrome: "readonly",
        document: "readonly",
        window: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        URL: "readonly",
        Intl: "readonly",
        MutationObserver: "readonly",
        MouseEvent: "readonly",
        TECH_KEYWORDS: "readonly",
        browserApi: "readonly",
        DEFAULT_BADGE_PREFS: "readonly",
        location: "readonly",
        confirm: "readonly"
      }
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          "caughtErrors": "none",
          "ignoreRestSiblings": true,
          "varsIgnorePattern": "^(browserApi|DEFAULT_BADGE_PREFS|TECH_KEYWORDS)$"
        }
      ],
      "no-undef": "error",
      "no-empty": "off"
    }
  },
  {
    ignores: ["web-ext-artifacts/", "node_modules/", ".opencode/"]
  }
];
