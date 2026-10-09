module.exports = {
    env: {
        browser: true,
        es2021: true
    },
    extends: [
        'eslint:recommended'
    ],
    parserOptions: {
        ecmaVersion: 12,
        sourceType: 'module'
    },
    rules: {
        'no-empty': ['error', { allowEmptyCatch: true }]
    },
    overrides: [
        {
            files: ['uvtools2/js/rf-log.js'],
            env: {
                node: true
            }
        }
    ]
};
