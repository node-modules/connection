'use strict';

const net = require('net');
const awaitFirst = require('await-first');
const awaitEvent = require('await-event');
const Connection = require('..');
const Decoder = require('sofa-bolt-node/lib/decoder');
const Encoder = require('sofa-bolt-node/lib/encoder');
const protocol = {
  encoder: opts => new Encoder(opts),
  decoder: opts => new Decoder(opts),
};

const HOST = '127.0.0.1';
const PORT = 12200;

async function createConnection(hostname, port) {
  const socket = net.connect(port, hostname);
  await awaitFirst(socket, [ 'connect', 'error' ]);
  return new Connection({
    logger: console,
    socket,
    protocol,
  });
}

async function createServer(port) {
  const server = net.createServer();
  server.listen(port);
  await awaitEvent(server, 'listening');
  return server;
}

async function waitServerConnection(server) {
  const socket = await awaitEvent(server, 'connection');
  return new Connection({
    logger: console,
    socket,
    protocol,
  });
}

async function doRequest(conn) {
  return conn.writeRequest({
    timeout: 100,
    targetAppName: 'foo',
    args: [ 'peter' ],
    serverSignature: 'com.alipay.sofa.rpc.quickstart.HelloService:1.0',
    methodName: 'sayHello',
    methodArgSigs: [ 'java.lang.String' ],
    requestProps: null,
  });
}

async function doResponse(conn) {
  const req = await awaitEvent(conn, 'request');
  console.log('get request: ', req);
  return conn.writeResponse(req, {
    error: null,
    appResponse: 'hello, peter',
    responseProps: null,
  });
}

async function main() {
  let server;
  let clientConn;
  let serverConn;
  try {
    server = await createServer(PORT);
    const serverPromise = waitServerConnection(server);
    clientConn = await createConnection(HOST, PORT);
    serverConn = await serverPromise;
    doResponse(serverConn);
    const res = await doRequest(clientConn);
    console.log('get response: ', res);
  } finally {
    await Promise.all([
      clientConn.close(),
      serverConn.close(),
    ]);
    server.close();
  }
}

main().catch(console.log);
