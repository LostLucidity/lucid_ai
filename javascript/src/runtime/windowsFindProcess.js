"use strict";

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

async function runCommand(command, args) {
  const { stdout } = await execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  return stdout;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function parseListeningProcesses(output, requestedPort) {
  const port = String(requestedPort);
  const seenPids = new Set();

  return String(output)
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .filter(columns => {
      if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') {
        return false;
      }

      const localAddress = columns[1];
      const localPort = localAddress.slice(localAddress.lastIndexOf(':') + 1);
      return localPort === port && columns[3].toUpperCase() === 'LISTENING';
    })
    .map(columns => Number.parseInt(columns[4], 10))
    .filter(pid => {
      if (!Number.isInteger(pid) || seenPids.has(pid)) {
        return false;
      }

      seenPids.add(pid);
      return true;
    })
    .map(pid => ({ pid }));
}

function parseTaskList(output) {
  return String(output)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('"'))
    .map(parseCsvLine)
    .filter(columns => columns.length >= 2)
    .map(columns => ({
      name: columns[0],
      pid: Number.parseInt(columns[1], 10),
    }))
    .filter(processInfo => Number.isInteger(processInfo.pid));
}

function matchesName(processName, requestedName, strict) {
  const actual = processName.toLowerCase();
  const expected = String(requestedName).toLowerCase();

  if (!strict) {
    return actual.includes(expected);
  }

  return actual === expected ||
    (actual.endsWith('.exe') && actual.slice(0, -4) === expected);
}

function createWindowsFindProcess(commandRunner = runCommand) {
  return async function findProcess(by, value, strict = false) {
    if (by === 'port') {
      const output = await commandRunner('netstat', ['-ano', '-p', 'TCP']);
      return parseListeningProcesses(output, value);
    }

    if (by === 'name' || by === 'pid') {
      const output = await commandRunner('tasklist', ['/FO', 'CSV', '/NH']);
      const processes = parseTaskList(output);

      if (by === 'pid') {
        const requestedPid = Number.parseInt(value, 10);
        return processes.filter(processInfo => processInfo.pid === requestedPid);
      }

      return processes.filter(processInfo => matchesName(processInfo.name, value, strict));
    }

    throw new Error(`do not support find by "${by}"`);
  };
}

module.exports = createWindowsFindProcess();
module.exports.createWindowsFindProcess = createWindowsFindProcess;
module.exports.parseListeningProcesses = parseListeningProcesses;
module.exports.parseTaskList = parseTaskList;
