function loadConfig(defaultMap) {
  if (defaultMap === undefined) delete process.env.DEFAULT_MAP;
  else process.env.DEFAULT_MAP = defaultMap;
  jest.resetModules();
  return require("../../config/config");
}

describe("default map configuration", () => {
  const originalDefaultMap = process.env.DEFAULT_MAP;

  afterEach(() => {
    if (originalDefaultMap === undefined) delete process.env.DEFAULT_MAP;
    else process.env.DEFAULT_MAP = originalDefaultMap;
    jest.resetModules();
  });

  it("defaults to AbyssalReefAIE", () => {
    expect(loadConfig(undefined).defaultMap).toBe("AbyssalReefAIE");
  });

  it("preserves DEFAULT_MAP as an explicit override", () => {
    expect(loadConfig("CustomMapAIE").defaultMap).toBe("CustomMapAIE");
  });
});
