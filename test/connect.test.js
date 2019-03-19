'use strict';

const net = require('net');
const awaitEvent = require('await-event');
const assert = require('assert');
const Connection = require('../lib/connection');
const Decoder = require('sofa-bolt-node/lib/decoder');
const Encoder = require('sofa-bolt-node/lib/encoder');
const protocol = {
  name: 'Rpc',
  encoder: opts => new Encoder(opts),
  decoder: opts => new Decoder(opts),
};

describe('connect.test.js', () => {
  let server;

  beforeEach(async () => {
    server = net.createServer();
    server.listen(12200);
    await awaitEvent(server, 'listening');
  });

  afterEach(() => {
    server.close();
  });

  it('connect success', async () => {
    const socket = net.createConnection(12200);
    const conn = new Connection({
      socket,
      logger: console,
      protocol,
    });
    await conn.ready();
    await conn.close();
  });

  it('connect timeout', async () => {
    const socket = net.createConnection({ host: '2.2.2.2', port: 12200 });
    const conn = new Connection({
      socket,
      logger: console,
      protocol,
      connectTimeout: 1,
      url: '2.2.2.2:12200',
    });
    let error;
    try {
      await conn.ready();
    } catch (e) {
      error = e;
    } finally {
      assert(error);
      assert(error.name === 'RpcSocketConnectTimtoutError');
      assert(error.message === 'connect timeout(1ms), 2.2.2.2:12200');
    }
    assert(conn._closed === true);
    assert(conn.socket.destroyed === true);
    assert(conn._encoder.destroyed === true);
    assert(conn._decoder.destroyed === true);
  });

  it('connect error', async () => {
    const socket = net.createConnection({ host: 'never_can_found', port: 12200 });
    const conn = new Connection({
      socket,
      logger: console,
      protocol,
      url: '2.2.2.2:12200',
    });
    let error;
    try {
      await conn.ready();
    } catch (e) {
      error = e;
    } finally {
      assert(error);
      assert(error.name === 'RpcSocketError');
    }
    assert(conn._closed === true);
    assert(conn.socket.destroyed === true);
    assert(conn._encoder.destroyed === true);
    assert(conn._decoder.destroyed === true);
  });
});
