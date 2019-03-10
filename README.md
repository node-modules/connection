# connection

[connection](https://github.com/node-modules/connection) socket wrapper

[![NPM version][npm-image]][npm-url]
[![build status][travis-image]][travis-url]
[![Test coverage][codecov-image]][codecov-url]
[![David deps][david-image]][david-url]
[![Known Vulnerabilities][snyk-image]][snyk-url]
[![npm download][download-image]][download-url]

[npm-image]: https://img.shields.io/npm/v/connection.svg?style=flat-square
[npm-url]: https://npmjs.org/package/connection
[travis-image]: https://img.shields.io/travis/node-modules/connection.svg?style=flat-square
[travis-url]: https://travis-ci.org/node-modules/connection
[codecov-image]: https://codecov.io/gh/node-modules/connection/branch/master/graph/badge.svg
[codecov-url]: https://codecov.io/gh/node-modules/connection
[david-image]: https://img.shields.io/david/node-modules/connection.svg?style=flat-square
[david-url]: https://david-dm.org/node-modules/connection
[snyk-image]: https://snyk.io/test/npm/connection/badge.svg?style=flat-square
[snyk-url]: https://snyk.io/test/npm/connection
[download-image]: https://img.shields.io/npm/dm/connection.svg?style=flat-square
[download-url]: https://npmjs.org/package/connection

## Usage

### Client Socket

```js
const net = require('net');
const awaitFirst = require('await-first');
const Connection = require('connection');

const Decoder = require('sofa-bolt-node/lib/decoder');
const Encoder = require('sofa-bolt-node/lib/encoder');
// bolt protocol example
const protocol = {
  name: 'Rpc',
  encoder: opts => new Encoder(opts),
  decoder: opts => new Decoder(opts),
};

async function createConnection(hostname, port) {
  const socket = net.connect(port, hostname);
  await awaitFirst(socket, [ 'connect', 'error' ]);
  return new Connection({
    logger: console,
    socket,
    protocol,
  });
}

const conn = await createConnection('127.0.0.1', 12200);

conn.writeRequest({
  targetAppName: 'foo',
  args: [ 'peter' ],
  serverSignature: 'com.alipay.sofa.rpc.quickstart.HelloService:1.0',
  methodName: 'sayHello',
  methodArgSigs: [ 'java.lang.String' ],
  requestProps: null,
});

```

### Server Socket

```js
const Connection = require('connection');
const server = net.createServer();
server.listen(port);

server.on('connection', sock => {
  const conn = new Connection({
    logger: console,
    socket: sock,
    protocol,
  });
  
  conn.on('request', req => {
    conn.writeResponse(req, {
      error: null,
      appResponse: 'hello, peter',
      responseProps: null,
    });
  });
});
```

[More example](./example)

### API
- oneway() - one way call
- async writeRequest(req) - write request and wait response
- async writeResponse(req, res) - write response
- async close() - wait all pending request done and destroy the socket
- async forceClose() - abort all pending request and destroy the socket
- get protocolOptions() - encoder/decoder constructor options, can be overwrite when custom protocol

### Protocol implement

```typescript
interface Request {
  /**
   * If request is oneway, shoule set to true
   */
  oneway: boolean,
  /**
   * writeRequest will use the timeout to set the timer
   */
  timeout: number,
  /**
   * request packet type, request|heartbeat|response 
   */
  packetType: string,
}

interface Response {
  packetId: number,
}

interface Encoder extends Transform {
  /**
   * write request to socket
   * Connection#writeRequest and Connection#oneway will call the function.
   * @param {number} id - the request id
   * @param {Object} req - the request object should be encoded
   * @param {Function} cb - the encode callback
   */
  writeRequest(id: number, req: object, cb);
  /**
   * write response to socket
   * Connection#writeResponse will call the function.
   * @param {Object} req - the request object
   * @param {Object} res - the response object should be encoded
   * @param {Function} cb - the encode callback
   */
  writeResponse(req: object, res: object, cb);
}

interface Decoder extends Writable {
  // events
  // - request emit when have request packet
  // - heartbeat emit when have heartbeat packet
  // - response emit when have response packet
}

interface Protocol {
  name: string;
  encode(options: any): Encoder;
  decode(options: any): Decoder;
}
```
