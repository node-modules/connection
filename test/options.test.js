'use strict';

const Decoder = require('sofa-bolt-node/lib/decoder');
const Encoder = require('sofa-bolt-node/lib/encoder');
const net = require('net');
const awaitEvent = require('await-event');
const assert = require('assert');
const Connection = require('../lib/connection');

const protocol = {
  name: 'Rpc',
  encoder: opts => new Encoder(opts),
  decoder: opts => new Decoder(opts),
};

describe('test/options.test.js', () => {
  it('protocolOptions should work', async () => {
    const port = 12200;
    const server = net.createServer();
    server.listen(port);
    const socket = net.createConnection({ port });
    await awaitEvent(socket, 'connect');
    const clientConn = new Connection({
      logger: console,
      socket,
      protocol,
      protocolOptions: {
        mock: 'foo',
      },
    });
    assert(clientConn._encoder.options.mock === 'foo');

    await clientConn.close();
    server.close();
  });
});
