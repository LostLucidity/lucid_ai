"use strict";

const { createWindowsFindProcess } = require('../../src/runtime/windowsFindProcess');

describe('Windows process discovery compatibility', () => {
  test('finds a listening port without invoking WMIC', async () => {
    const calls = [];
    const findProcess = createWindowsFindProcess(async (command, args) => {
      calls.push({ command, args });
      return [
        '  Proto  Local Address          Foreign Address        State           PID',
        '  TCP    127.0.0.1:5000         0.0.0.0:0              LISTENING       4321',
        '  TCP    127.0.0.1:5001         0.0.0.0:0              LISTENING       9876',
      ].join('\r\n');
    });

    await expect(findProcess('port', 5000)).resolves.toEqual([{ pid: 4321 }]);
    expect(calls).toEqual([{ command: 'netstat', args: ['-ano', '-p', 'TCP'] }]);
    expect(calls.some(call => call.command.toLowerCase() === 'wmic')).toBe(false);
  });

  test('finds the SC2 executable by exact name without invoking WMIC', async () => {
    const calls = [];
    const findProcess = createWindowsFindProcess(async (command, args) => {
      calls.push({ command, args });
      return [
        '"SC2_x64.exe","9876","Console","1","1,234 K"',
        '"node.exe","4321","Console","1","42,000 K"',
      ].join('\r\n');
    });

    await expect(findProcess('name', 'SC2_x64.exe', true)).resolves.toEqual([
      { name: 'SC2_x64.exe', pid: 9876 },
    ]);
    expect(calls).toEqual([{ command: 'tasklist', args: ['/FO', 'CSV', '/NH'] }]);
    expect(calls.some(call => call.command.toLowerCase() === 'wmic')).toBe(false);
  });
});
