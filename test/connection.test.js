'use strict';

const net = require('net');
const assert = require('assert');
const awaitEvent = require('await-event');
const mm = require('mm');

const Connection = require('../lib/connection');
const Decoder = require('sofa-bolt-node/lib/decoder');
const Encoder = require('sofa-bolt-node/lib/encoder');
const protocol = {
  name: 'Rpc',
  encoder: opts => new Encoder(opts),
  decoder: opts => new Decoder(opts),
};

const port = 12200;
const FOO_REQUEST = {
  targetAppName: 'foo',
  args: [ 'peter' ],
  serverSignature: 'com.alipay.sofa.rpc.quickstart.HelloService:1.0',
  methodName: 'sayHello',
  methodArgSigs: [ 'java.lang.String' ],
  requestProps: null,
};
const FOO_RESPONSE = {
  error: null,
  appResponse: 'hello, peter',
  responseProps: null,
};

describe('test/connection.test.js', () => {
  afterEach(() => {
    mm.restore();
  });

  let server;
  let serverConn;
  let clientConn;

  beforeEach(async () => {
    server = net.createServer();
    server.listen(12200);
    const connectionEvent = awaitEvent(server, 'connection');
    const socket = net.createConnection({ port });
    await awaitEvent(socket, 'connect');
    clientConn = new Connection({
      logger: console,
      socket,
      protocol,
    });
    serverConn = new Connection({
      logger: console,
      socket: await connectionEvent,
      protocol,
    });
  });

  afterEach(async () => {
    server.close();
  });

  describe('request', () => {

    afterEach(async () => {
      await clientConn.close();
      await serverConn.await('close');
    });

    describe('request success', () => {
      it('should get response', async () => {
        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        const resPromise = clientConn.writeRequest(req);
        const serverReceivedReq = await requestEvent;
        const res = Object.assign({}, FOO_RESPONSE);
        await serverConn.writeResponse(serverReceivedReq, res);
        const clientReceivedRes = await resPromise;
        assert.deepStrictEqual(serverReceivedReq.data, FOO_REQUEST);
        assert.deepStrictEqual(clientReceivedRes.data, FOO_RESPONSE);
      });
    });

    describe('encode timeout', () => {
      beforeEach(() => {
        mm(clientConn, '_writeRequest', () => {
          return new Promise(() => {});
        });
      });

      it('should throw timeout error', async () => {
        const req = Object.assign({ timeout: 1 }, FOO_REQUEST);
        let error;
        try {
          await clientConn.writeRequest(req);
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcResponseTimeoutError');
          assert(/no response in \d+ms/.test(error.message));
        }
      });
    });

    describe('response timeout', () => {
      it('should throw timeout error', async () => {
        const req = Object.assign({ timeout: 1 }, FOO_REQUEST);
        let error;
        try {
          await clientConn.writeRequest(req);
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcResponseTimeoutError');
          assert(/no response in \d+ms/.test(error.message));
        }
      });
    });

    describe('request encode failed', () => {
      beforeEach(() => {
        mm(Encoder.prototype, 'writeRequest', (id, req, err) => {
          return err(new Error('mock error'));
        });
      });

      it('should throw encode error', async () => {
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        let error;
        try {
          await clientConn.writeRequest(req);
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcRequestEncodeError');
          assert(/mock error/.test(error.message));
        }
      });
    });

    describe('response encode failed', () => {
      beforeEach(() => {
        mm(Encoder.prototype, 'writeResponse', (req, res, callback) => {
          return callback(new Error('mock error'));
        });
      });

      it('should throw encode error', async () => {
        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        const resPromise = clientConn.writeRequest(req);
        const serverReceivedReq = await requestEvent;
        const res = Object.assign({}, FOO_RESPONSE);
        let error;
        try {
          await serverConn.writeResponse(serverReceivedReq, res);
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcResponseEncodeError');
          assert(/mock error/.test(error.message));
        }
        try {
          await resPromise;
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcResponseTimeoutError');
          assert(/no response in \d+ms/.test(error.message));
        }
      });
    });
  });

  describe('oneway', () => {
    afterEach(async () => {
      await clientConn.close();
      await serverConn.await('close');
    });

    describe('oneway encode failed', () => {
      beforeEach(() => {
        mm(Encoder.prototype, 'writeRequest', (id, req, err) => {
          return err(new Error('mock error'));
        });
      });

      it('should throw encode error', async () => {
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        const errorEvent = clientConn.await('error');
        clientConn.oneway(req);
        let error;
        try {
          await errorEvent;
        } catch (e) {
          error = e;
        }
        assert(error);
        assert(error.name === 'RpcOneWayEncodeError');
        assert(/mock error/.test(error.message));
      });
    });

    it('should work', async () => {
      const requestEvent = serverConn.await('request');
      const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
      clientConn.oneway(req);
      const serverReceivedReq = await requestEvent;
      assert.deepStrictEqual(serverReceivedReq.data, FOO_REQUEST);
    });
  });

  describe('decode error', () => {

    describe('request decode failed', () => {
      beforeEach(() => {
        mm(serverConn._decoder, '_decode', () => {
          throw new Error('mock error');
        });
      });

      it('should throw encode error', async () => {
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        let error;
        let clientError;
        let serverError;
        let clientClosed;
        let serverClosed;
        clientConn.on('error', e => {
          clientError = e;
        });
        serverConn.on('error', e => {
          serverError = e;
        });
        clientConn.on('close', () => {
          clientClosed = true;
        });
        serverConn.on('close', () => {
          serverClosed = true;
        });
        try {
          await clientConn.writeRequest(req);
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.name === 'RpcSocketCloseError');
          assert(/The socket was closed/.test(error.message));
        }
        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(!clientError);
        assert(serverError);
        assert(serverError.message.startsWith('mock error'));
        assert(clientClosed === true);
        assert(serverClosed === true);
      });
    });

    describe('response decode failed', () => {
      beforeEach(() => {
        mm(clientConn._decoder, '_decode', () => {
          throw new Error('mock error');
        });
      });

      it('should throw encode error', async () => {
        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        let error;
        let clientError;
        let serverError;
        let clientClosed;
        let serverClosed;
        clientConn.on('error', e => {
          clientError = e;
        });
        serverConn.on('error', e => {
          serverError = e;
        });
        clientConn.on('close', () => {
          clientClosed = true;
        });
        serverConn.on('close', () => {
          serverClosed = true;
        });
        try {
          const resPromise = clientConn.writeRequest(req);
          const serverReceivedReq = await requestEvent;
          const res = Object.assign({}, FOO_RESPONSE);
          await serverConn.writeResponse(serverReceivedReq, res);
          await resPromise;
        } catch (e) {
          error = e;
        } finally {
          assert(error);
          assert(error.message === 'mock error, 127.0.0.1:12200');
        }
        await serverConn.await('close');
        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(clientError);
        assert(!serverError);
        assert(clientError.message === 'mock error, 127.0.0.1:12200');
        assert(clientClosed === true);
        assert(serverClosed === true);
      });
    });
  });

  describe('close', () => {
    let clientError;
    let serverError;
    let clientClosed;
    let serverClosed;

    beforeEach(() => {
      clientError = null;
      serverError = null;
      clientClosed = false;
      serverClosed = false;
      clientConn.on('error', e => {
        clientError = e;
      });
      serverConn.on('error', e => {
        serverError = e;
      });
      clientConn.on('close', () => {
        clientClosed = true;
      });
      serverConn.on('close', () => {
        serverClosed = true;
      });
    });

    describe('have pending request', () => {
      it('should request done', async () => {
        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        const resPromise = clientConn.writeRequest(req);

        const closePromise = clientConn.close();

        const serverReceivedReq = await requestEvent;
        const res = Object.assign({}, FOO_RESPONSE);
        await serverConn.writeResponse(serverReceivedReq, res);
        const clientReceivedRes = await resPromise;

        await Promise.all([
          closePromise,
          serverConn.await('close'),
        ]);

        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(!clientError);
        assert(!serverError);
        assert(clientClosed === true);
        assert(serverClosed === true);
        assert.deepStrictEqual(clientReceivedRes.data, FOO_RESPONSE);
      });
    });

    describe('close with error', () => {
      it('should emit error', async () => {
        const clientClosePromise = clientConn.await('close');
        await clientConn.close(new Error('mock error'));
        await Promise.all([
          clientClosePromise,
          serverConn.await('close'),
        ]);

        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(clientError);
        assert(/mock error/.test(clientError.message));
        assert(!serverError);
        assert(clientClosed === true);
        assert(serverClosed === true);
      });
    });

    describe('client server close simultaneously', () => {
      it('should clean resource, request', async () => {
        const req = Object.assign({ timeout: 1000 }, FOO_REQUEST);

        let writeError;
        clientConn.writeRequest(req).catch(err => {
          writeError = err;
        });

        await serverConn.await('request');

        await Promise.all([
          serverConn.forceClose(),
          clientConn.close(),
        ]);


        server.close();
        await awaitEvent(server, 'close');

        assert(writeError);
        assert(writeError.name === 'RpcSocketCloseError');

        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(!clientError);
        assert(!serverError);
        assert(clientClosed === true);
        assert(serverClosed === true);
      });
    });
  });

  describe('force close', () => {
    describe('with out error', () => {
      it('should clean request', async () => {
        let responseError;
        let requestError;
        let clientError;
        let serverError;
        let clientClosed;
        let serverClosed;
        clientConn.on('error', e => {
          clientError = e;
        });
        serverConn.on('error', e => {
          serverError = e;
        });
        clientConn.on('close', () => {
          clientClosed = true;
        });
        serverConn.on('close', () => {
          serverClosed = true;
        });

        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        clientConn.writeRequest(req).catch(e => {
          requestError = e;
        });

        const serverReceivedReq = await requestEvent;
        const serverClosePromise = serverConn.await('close');
        await clientConn.forceClose();
        await serverClosePromise;

        const res = Object.assign({}, FOO_RESPONSE);
        try {
          await serverConn.writeResponse(serverReceivedReq, res);
        } catch (e) {
          responseError = e;
        }

        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(!clientError);
        assert(!serverError);
        assert(clientClosed === true);
        assert(serverClosed === true);
        assert(requestError);
        assert(/The socket was closed/.test(requestError.message));
        assert(requestError.name === 'RpcSocketCloseError');
        assert(responseError);
        assert(responseError.name === 'RpcResponseEncodeError');
        assert(/write after/.test(responseError.message));
      });
    });

    describe('with error', () => {
      it('should clean request', async () => {
        let responseError;
        let requestError;
        let clientError;
        let serverError;
        let clientClosed;
        let serverClosed;
        clientConn.on('error', e => {
          clientError = e;
        });
        serverConn.on('error', e => {
          serverError = e;
        });
        clientConn.on('close', () => {
          clientClosed = true;
        });
        serverConn.on('close', () => {
          serverClosed = true;
        });

        const requestEvent = serverConn.await('request');
        const req = Object.assign({ timeout: 50 }, FOO_REQUEST);
        clientConn.writeRequest(req).catch(e => {
          requestError = e;
        });

        const serverReceivedReq = await requestEvent;
        const serverClosePromise = serverConn.await('close');
        await clientConn.forceClose(new Error('mock error'));
        await serverClosePromise;
        const res = Object.assign({}, FOO_RESPONSE);
        try {
          await serverConn.writeResponse(serverReceivedReq, res);
        } catch (e) {
          responseError = e;
        }

        assert(clientConn._closed === true);
        assert(serverConn._closed === true);
        assert(clientConn.socket.destroyed === true);
        assert(serverConn.socket.destroyed === true);
        assert(clientConn._encoder.destroyed === true);
        assert(clientConn._decoder.destroyed === true);
        assert(serverConn._encoder.destroyed === true);
        assert(serverConn._decoder.destroyed === true);
        assert(clientClosed === true);
        assert(serverClosed === true);
        assert(clientError);
        assert(clientError.name === 'RpcSocketError');
        assert(/mock error/.test(clientError.message));
        assert(requestError);
        assert(requestError.name === 'RpcSocketError');
        assert(/mock error/.test(requestError.message));
        assert(!serverError);
        assert(responseError);
        assert(responseError.name === 'RpcResponseEncodeError');
        assert(/write after/.test(responseError.message));
      });
    });
  });
});
