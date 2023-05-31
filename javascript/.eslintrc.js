module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": "eslint:recommended",
    "globals": {
        "Atomics": "readonly",
        "SharedArrayBuffer": "readonly"
    },
    "parser": "@babel/eslint-parser",
    "parserOptions": {
        "ecmaVersion": 2018,
        "sourceType": "script",
        "ecmaFeatures": {
            "jsx": true
        }
    },
    "rules": {
    }
};