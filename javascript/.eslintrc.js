module.exports = {
  env: {
    es6: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/errors",
    "plugin:import/warnings",
  ],
  globals: {
    Atomics: "readonly",
    SharedArrayBuffer: "readonly",
  },
  parser: "@babel/eslint-parser",
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: "script",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: [
    "import",
  ],
  rules: {
    "no-unused-vars": [
      "error",
      {
        "argsIgnorePattern": "^_",
        "vars": "all",
        "varsIgnorePattern": "^_",
        "ignoreRestSiblings": false,
        "args": "after-used",
      },
    ],
    "import/order": [
      "error",
      {
        "newlines-between": "always", // Adjust this to your preference
        "groups": [["builtin", "external"], "internal", ["parent", "sibling", "index"]],
        "alphabetize": {
          "order": "asc", // or 'desc'
          "caseInsensitive": true,
        },
      },
    ],
    "class-methods-use-this": [
      "error",
      {
        "exceptMethods": [],
        "enforceForClassFields": true,
      }
    ],
    "no-unused-private-class-members": "error", // Detect unused private class members
  },
};
