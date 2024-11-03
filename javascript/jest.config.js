module.exports = {
  rootDir: '.',
  modulePaths: [
    '<rootDir>/src',
    '<rootDir>/config',
    '<rootDir>/data'
  ],
  moduleDirectories: ['node_modules', 'src', 'config', 'data'],
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/src/**/*.test.js',
  ],
};
