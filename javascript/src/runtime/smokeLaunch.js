"use strict";

const MANAGED_OPTIONS = ['--GamePort', '--StartPort', '--LadderServer'];

function isManagedRuntime(argv = process.argv) {
  return argv.some(argument => MANAGED_OPTIONS.some(option => argument === option || argument.startsWith(`${option}=`)));
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child, timeoutMs) {
  if (hasExited(child)) return Promise.resolve({ exited: true, reason: 'already_exited' });
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      resolve(result);
    };
    const onExit = () => finish({ exited: true, reason: 'exit' });
    const onError = error => finish({ exited: false, reason: 'error', error });
    const timer = setTimeout(() => finish({ exited: false, reason: 'timeout' }), timeoutMs);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

function createSmokeLaunch(engine, options = {}) {
  const argv = options.argv || process.argv;
  const exitWaitMs = options.exitWaitMs || 5000;
  let child = null;

  async function launch() {
    if (isManagedRuntime(argv)) {
      throw new Error('SC2_SMOKE_SECONDS cannot launch a managed runtime');
    }
    const launched = await engine.launcher();
    if (!launched || typeof launched !== 'object' || !Number.isInteger(launched.pid) || typeof launched.kill !== 'function') {
      throw new Error('Local smoke launcher did not return an owned SC2 child process');
    }
    child = launched;
    return child;
  }

  async function cleanup() {
    if (!child) return null;
    const beforeTermination = await waitForExit(child, exitWaitMs);
    if (beforeTermination.exited) return { pid: child.pid, disposition: 'exited' };
    if (beforeTermination.reason === 'error') throw beforeTermination.error;
    if (!child.kill('SIGTERM')) throw new Error(`Unable to terminate owned SC2 child ${child.pid}`);
    const afterTermination = await waitForExit(child, exitWaitMs);
    if (!afterTermination.exited) {
      throw new Error(`Owned SC2 child ${child.pid} did not exit after termination`);
    }
    return { pid: child.pid, disposition: 'terminated' };
  }

  return { launch, cleanup, get child() { return child; } };
}

module.exports = { createSmokeLaunch, isManagedRuntime };
