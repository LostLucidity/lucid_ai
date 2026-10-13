const { installSmokeController } = require('../../src/runtime/smokeController');

function fixture() {
  let loop = 0;
  const client = {
    step: jest.fn(async ({ count }) => { loop += count; return {}; }),
    action: jest.fn(async () => ({ result: [1] })),
  };
  const engine = {
    getWorld: () => ({ resources: { get: () => ({ frame: { getGameLoop: () => loop }, actions: { _client: client } }) } }),
    shutdown: jest.fn(),
    runLoop: jest.fn(async () => 'continued'),
  };
  return { client, engine, setLoop: value => { loop = value; } };
}

test('caps the next step at the boundary and blocks subsequent actions and steps', async () => {
  const f = fixture();
  const step = f.client.step;
  const action = f.client.action;
  const runLoop = f.engine.runLoop;
  const report = jest.fn();
  const control = installSmokeController(f.engine, 210, report);
  f.setLoop(4702);
  await f.client.step({ count: 4 });
  expect(step).toHaveBeenCalledWith({ count: 2 });
  await f.client.action({ actions: [] });
  await f.client.step({ count: 4 });
  await f.engine.runLoop();
  expect(action).not.toHaveBeenCalled();
  expect(step).toHaveBeenCalledTimes(1);
  expect(runLoop).not.toHaveBeenCalled();
  expect(control.receipt).toMatchObject({ reason: 'game_time_limit', gameLoop: 4704 });
  expect(f.engine.shutdown).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledTimes(1);
});

test('a swallowed action exception still stops the engine and retains the first reason', async () => {
  const f = fixture();
  f.client.action.mockRejectedValue(new Error('protocol failure'));
  const control = installSmokeController(f.engine, 210, jest.fn());
  await f.client.action({}).catch(() => {});
  control.stop('step_error', 'later error');
  await f.engine.runLoop();
  expect(control.receipt.reason).toBe('action_error');
  expect(f.engine.shutdown).toHaveBeenCalledTimes(1);
});

test('first rejected action stops even when the callback returns normally', async () => {
  const f = fixture();
  f.client.action.mockResolvedValue({ result: [1, 2] });
  const runLoop = f.engine.runLoop;
  const control = installSmokeController(f.engine, 210, jest.fn());
  await f.client.action({});
  await f.engine.runLoop();
  expect(control.receipt.reason).toBe('rejected_action');
  expect(runLoop).not.toHaveBeenCalled();
});

test('passes through permitted operations and restores original methods', async () => {
  const f = fixture();
  const original = { ...f.client, runLoop: f.engine.runLoop };
  const control = installSmokeController(f.engine, 210, jest.fn());
  expect(await f.client.action({})).toEqual({ result: [1] });
  expect(await f.engine.runLoop()).toBe('continued');
  expect(control.receipt).toBeNull();
  control.restore();
  expect(f.client.step).toBe(original.step);
  expect(f.client.action).toBe(original.action);
  expect(f.engine.runLoop).toBe(original.runLoop);
});

test.each(['', 'no', '-1', 'Infinity', '0'])('rejects invalid duration %s before touching engine', value => {
  expect(() => installSmokeController({}, value)).toThrow();
});

test('shutdown failure is recorded once and cannot reopen the action gate', async () => {
  const f = fixture();
  f.engine.shutdown.mockImplementation(() => { throw new Error('close failed'); });
  const control = installSmokeController(f.engine, 210, jest.fn());
  control.stop('startup_error');
  expect(control.receipt.shutdownError).toBe('close failed');
  expect(control.beforeActions()).toBe(false);
});

test('installed engine recursion stops at the exact cutoff without an external poll', async () => {
  const createEngine = require('@node-sc2/core/engine/create-engine');
  const engine = createEngine({ launch: false });
  const { frame, actions: { _client: client } } = engine.getWorld().resources.get();
  client.status = 3;
  frame._gameLoop = 4702;
  client.step = jest.fn(async ({ count }) => { frame._gameLoop += count; });
  client.close = jest.fn();
  engine.dispatch = jest.fn(async () => {});
  const step = client.step;
  const control = installSmokeController(engine, 210, jest.fn());
  const receipt = await engine.runLoop();
  expect(receipt.reason).toBe('game_time_limit');
  expect(frame._gameLoop).toBe(4704);
  expect(step).toHaveBeenCalledTimes(1);
  expect(client.close).toHaveBeenCalledTimes(1);
  control.restore();
});

test.each(['step_error', 'game_time_limit'])('run wires the controller into real bot callbacks: %s', async reason => {
  const savedSeconds = process.env.SC2_SMOKE_SECONDS;
  const savedExitCode = process.exitCode;
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  const f = fixture();
  f.engine.connect = jest.fn(async () => {});
  if (reason === 'game_time_limit') f.setLoop(4704);
  f.engine.runGame = async (_map, players) => {
    // An invalid world would fail inside the real callback unless the cutoff guards it.
    await players[0].onStep({});
    return f.engine.runLoop();
  };
  process.env.SC2_SMOKE_SECONDS = '210';
  jest.doMock('../../src/runtime/nodeSc2Core', () => ({
    createEngine: () => f.engine,
    createAgent: blueprint => blueprint,
    createPlayer: (_settings, agent) => agent,
  }));
  try {
    let bot;
    jest.isolateModules(() => { bot = require('../../src/starcraftBot'); });
    const receipt = await bot.run();
    expect(receipt.reason).toBe(reason);
    expect(f.engine.shutdown).toHaveBeenCalledTimes(1);
    if (reason === 'step_error') expect(process.exitCode).toBe(1);
    else expect(errorLog).not.toHaveBeenCalled();
  } finally {
    jest.dontMock('../../src/runtime/nodeSc2Core');
    if (savedSeconds === undefined) delete process.env.SC2_SMOKE_SECONDS;
    else process.env.SC2_SMOKE_SECONDS = savedSeconds;
    process.exitCode = savedExitCode;
    log.mockRestore();
    errorLog.mockRestore();
  }
});
