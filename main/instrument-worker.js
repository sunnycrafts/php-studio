/* Runs the source instrumenter off the main thread. */
'use strict';
const { parentPort } = require('worker_threads');
const { instrument } = require('./instrument.js');

parentPort.on('message', ({ id, text }) => {
  try {
    parentPort.postMessage({ id, result: instrument(text) });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e && e.message || e) });
  }
});
