const createEngine = require('@node-sc2/core/engine/create-engine');
const debugSystem = require('@node-sc2/core/systems/debug');
const protobuf = require('protobufjs/light');
const { installSmokeController } = require('../../src/runtime/smokeController');
const Request = protobuf.Root.fromJSON(require('@node-sc2/proto/proto-bundle')).lookupType('Request');

function transportFixture() {
  const engine = createEngine({ launch: false });
  const world = engine.getWorld();
  const { frame, events, actions: { _client: client } } = world.resources.get();
  const sent = [];
  let closed = false;
  let serverLoop = 100;
  frame._gameLoop = serverLoop;
  client.status = 3;
  client._ws = {
    close: jest.fn(() => { closed = true; }),
    send(buffer) {
      const request = Request.toObject(Request.decode(buffer));
      const kind = Object.keys(request)[0];
      sent.push({ kind, afterClose: closed });
      if (kind === 'query' || kind === 'observation') return;
      if (kind === 'step') serverLoop += request.step.count;
      queueMicrotask(() => client._protoApiQueue[kind](null, {
        [kind]: kind === 'action' ? { result: [2] } : {},
      }));
    },
  };
  // Keep real dispatch and protocol queues; only gameplay systems are fixtures.
  engine.systems = [async () => { frame._gameLoop = serverLoop; }];
  world.agent = { readerId: events.createReader('agent'), systems: [], onStep: async () => {} };
  debugSystem.setup(world);
  return { engine, world, client, sent };
}

test('real dispatch settles with in-flight and queued requests on first action failure', async () => {
  const { engine, world, client, sent } = transportFixture();
  const report = jest.fn();
  const originalPush = client._promiseQueue.push;
  const control = installSmokeController(engine, 210, report);
  let results;
  let postStop;
  world.agent.onStep = async () => {
    const pending = Promise.allSettled([client.query({}), client.query({}), client.observation({})]);
    await client.action({ actions: [] });
    results = await pending;
  };
  world.agent.systems = [async () => {
    postStop = await Promise.allSettled([client.query({}), client.step({ count: 4 }), client.action({})]);
  }];
  let settled = false;
  let timer;
  const running = engine.runLoop().then(result => { settled = true; return result; });
  try {
    await Promise.race([running, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
    expect(settled).toBe(true);
    expect((await running).reason).toBe('rejected_action');
    for (const result of [...results, ...postStop]) {
      expect(result.status).toBe('rejected');
      expect(result.reason.code).toBe('SC2_SMOKE_STOPPED');
    }
    expect(sent.filter(entry => entry.kind === 'step')).toHaveLength(1);
    expect(sent.filter(entry => entry.kind === 'query')).toHaveLength(1);
    expect(sent.every(entry => !entry.afterClose)).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(client._ws.close).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(timer);
    await control.restore();
  }
  expect(client._promiseQueue.push).toBe(originalPush);
});

test('normal protocol traffic and restoration work when no stop is requested', async () => {
  const { engine, client, sent } = transportFixture();
  const originalPush = client._promiseQueue.push;
  const originalRequest = client._request;
  const control = installSmokeController(engine, 210, jest.fn());
  await expect(client.ping({})).resolves.toEqual({});
  expect(control.receipt).toBeNull();
  expect(client._ws.close).not.toHaveBeenCalled();
  await control.restore();
  expect(client._promiseQueue.push).toBe(originalPush);
  expect(client._request).toBe(originalRequest);
  await expect(client.ping({})).resolves.toEqual({});
  expect(sent.map(entry => entry.kind)).toEqual(['ping', 'ping']);
});

test('restoration drains queued cancellations before reopening original transport methods', async () => {
  const { engine, client, sent } = transportFixture();
  const originalPush = client._promiseQueue.push;
  const originalRequest = client._request;
  const control = installSmokeController(engine, 210, jest.fn());
  const pending = Promise.allSettled([client.query({}), client.query({})]);
  control.stop('step_error');
  await control.restore();
  const results = await pending;
  expect(results.every(result => result.status === 'rejected')).toBe(true);
  expect(sent.every(entry => !entry.afterClose)).toBe(true);
  expect(client._promiseQueue.push).toBe(originalPush);
  expect(client._request).toBe(originalRequest);
});
