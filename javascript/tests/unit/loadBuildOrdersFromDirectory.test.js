const fs = require('fs').promises;
const path = require('path');

const { loadBuildOrdersFromDirectory, buildOrderCache } = require('../../data/buildOrders/scripts/buildOrderUtils');

jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
  },
}));

describe('loadBuildOrdersFromDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key in buildOrderCache) {
      delete buildOrderCache[key];
    }
  });

  test('should load build orders from the specified directory', async () => {
    const mockDirectoryName = 'protoss';
    const buildOrdersDir = path.join(__dirname, '../../data/buildOrders', mockDirectoryName);

    const mockFiles = [
      {
        name: 'order1.js',
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      },
      {
        name: 'order2.js',
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      },
    ];

    jest.spyOn(fs, 'readdir').mockResolvedValue(mockFiles);

    const mockBuildOrder = {
      title: 'Sample Build Order',
      raceMatchup: 'PvT',
      steps: [],
      url: 'http://example.com',
    };

    jest.mock(
      path.join(__dirname, '../../data/buildOrders', mockDirectoryName, 'order1.js'),
      () => mockBuildOrder,
      { virtual: true }
    );

    jest.mock(
      path.join(__dirname, '../../data/buildOrders', mockDirectoryName, 'order2.js'),
      () => mockBuildOrder,
      { virtual: true }
    );

    const result = await loadBuildOrdersFromDirectory(mockDirectoryName);

    expect(fs.readdir).toHaveBeenCalledWith(buildOrdersDir, { withFileTypes: true });
    expect(result).toEqual({
      order1: mockBuildOrder,
      order2: mockBuildOrder,
    });
  });

  test('should use cached build orders if directory is loaded again', async () => {
    const mockDirectoryName = 'protoss';

    const mockFiles = [
      {
        name: 'order1.js',
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      },
      {
        name: 'order2.js',
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
      },
    ];

    jest.spyOn(fs, 'readdir').mockResolvedValue(mockFiles);

    const mockBuildOrder = {
      title: 'Sample Build Order',
      raceMatchup: 'PvT',
      steps: [],
      url: 'http://example.com',
    };

    jest.mock(
      path.join(__dirname, '../../data/buildOrders', mockDirectoryName, 'order1.js'),
      () => mockBuildOrder,
      { virtual: true }
    );

    jest.mock(
      path.join(__dirname, '../../data/buildOrders', mockDirectoryName, 'order2.js'),
      () => mockBuildOrder,
      { virtual: true }
    );

    const firstResult = await loadBuildOrdersFromDirectory(mockDirectoryName);
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual({
      order1: mockBuildOrder,
      order2: mockBuildOrder,
    });

    const secondResult = await loadBuildOrdersFromDirectory(mockDirectoryName);
    expect(fs.readdir).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual(firstResult);
  });
});
