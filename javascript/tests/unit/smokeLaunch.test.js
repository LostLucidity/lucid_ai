const { EventEmitter } = require('events');
const { createSmokeLaunch, isManagedRuntime } = require('../../src/runtime/smokeLaunch');

function childFixture({ exited = false, kill = null } = {}) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.exitCode = exited ? 0 : null;
  child.signalCode = null;
  child.kill = kill || jest.fn(() => {
    child.exitCode = 0;
    child.emit('exit', 0, 'SIGTERM');
    return true;
  });
  return child;
}

test.each([
  [['node', 'main.js', '--GamePort', '5000']],
  [['node', 'main.js', '--StartPort=5000']],
  [['node', 'main.js', '--LadderServer=127.0.0.1']],
])('recognizes managed runtime arguments: %j', argv => {
  expect(isManagedRuntime(argv)).toBe(true);
});

test('does not classify a local process as managed', () => {
  expect(isManagedRuntime(['node', 'main.js'])).toBe(false);
});

test('refuses to launch a smoke against a managed runtime', async () => {
  const launcher = jest.fn();
  const smoke = createSmokeLaunch({ launcher }, { argv: ['node', 'main.js', '--GamePort', '5000'] });
  await expect(smoke.launch()).rejects.toThrow('managed runtime');
  expect(launcher).not.toHaveBeenCalled();
});

test('retains an owned child and leaves an already exited child alone', async () => {
  const child = childFixture({ exited: true });
  const smoke = createSmokeLaunch({ launcher: jest.fn(async () => child) }, { argv: ['node', 'main.js'] });
  await expect(smoke.launch()).resolves.toBe(child);
  await expect(smoke.cleanup()).resolves.toEqual({ pid: 4321, disposition: 'exited' });
  expect(child.kill).not.toHaveBeenCalled();
});

test('terminates only the retained local child after its bounded exit wait', async () => {
  const child = childFixture();
  const smoke = createSmokeLaunch({ launcher: jest.fn(async () => child) }, { argv: ['node', 'main.js'], exitWaitMs: 1 });
  await smoke.launch();
  await expect(smoke.cleanup()).resolves.toEqual({ pid: 4321, disposition: 'terminated' });
  expect(child.kill).toHaveBeenCalledWith('SIGTERM');
});
