'use strict';

const assert = require('assert');
const Base = require('sdk-base');
const pump = require('pump');
// const awaitEvent = require('await-event');
const awaitFirst = require('await-first');

const utils = require('./utils');
const DEFAULT_ERROR_PREFIX = '';

class Connection extends Base {
  /**
   * @class
   * @param {object} options -
   * @param {Socket} options.socket -
   * @param {Logger} options.logger -
   * @param {Protocol} options.protocol -
   * @param {Object} [options.protocolOptions] -
   * @param {Map} [options.sentReqs] -
   * @param {string} [options.url] -
   * @param {number} [options.connectTimeout] -
   */
  constructor(options) {
    assert(options.logger, '[Connection] options.logger is required');
    assert(options.socket, '[Connection] options.socket is required');
    assert(options.protocol, '[Connection] options.protocol is required');
    assert(!options.socket.destroyed, '[Connection] options.socket should not be destroyed');
    assert(options.protocol.encoder, '[Connection] options.protocol have not encoder impl');
    assert(options.protocol.decoder, '[Connection] options.protocol have not decoder impl');
    super(Object.assign(Connection.defaultOptions(), options, { initMethod: '_init' }));
    this._encoder = this.protocol.encoder(this.protocolOptions);
    this._decoder = this.protocol.decoder(this.protocolOptions);
    this._closed = false;
    this._userClosed = false;
    this._connected = !this.socket.connecting;
    this.bindEvent();
    // @refer https://nodejs.org/en/docs/guides/backpressuring-in-streams/
    pump(this._encoder, this.socket, this._decoder, err => {
      this._handleClose(err);
    });
    this.buildErrorNames(this.protocol.name || DEFAULT_ERROR_PREFIX);
    this.on('error', err => this.logger.error(err));
  }

  async _init() {
    this.url = this.options.url;
    if (this._connected) {
      if (!this.url) {
        this.url = `${this.socket.remoteAddress}:${this.socket.remotePort}`;
      }
      return;
    }
    this.socket.setTimeout(this.options.connectTimeout);
    const { event } = await awaitFirst(this.socket, [ 'connect', 'timeout', 'error' ]);
    if (event === 'timeout') {
      const err = new Error('connect timeout(' + this.options.connectTimeout + 'ms), ' + this.url);
      err.name = this.SocketConnectTimeoutError;
      this.close();
      throw err;
    }
    if (!this.url) {
      this.url = `${this.socket.remoteAddress}:${this.socket.remotePort}`;
    }
    this.socket.setTimeout(0);
    this._connected = true;
  }

  bindEvent() {
    this._decoder.on('request', req => this.emit('request', req));
    this._decoder.on('heartbeat', hb => this.emit('heartbeat', hb));
    this._decoder.on('response', res => this._handleResponse(res));
    this._decoder.on('heartbeat_ack', res => this._handleResponse(res));
  }

  buildErrorNames(errorPrefix) {
    this.OneWayEncodeErrorName = `${errorPrefix}OneWayEncodeError`;
    this.SocketConnectTimeoutError = `${errorPrefix}SocketConnectTimtoutError`;
    this.ResponseEncodeErrorName = `${errorPrefix}ResponseEncodeError`;
    this.ResponseTimeoutErrorName = `${errorPrefix}ResponseTimeoutError`;
    this.RequestEncodeErrorName = `${errorPrefix}RequestEncodeError`;
    this.SocketErrorName = `${errorPrefix}SocketError`;
    this.SocketCloseError = `${errorPrefix}SocketCloseError`;
  }

  async writeRequest(req) {
    const id = utils.nextId();
    const timer = this._requestTimer(id, req);
    try {
      const p = this._waitResponse(id, req);
      this._writeRequest(id, req);
      return await p;
    } catch (e) {
      this._cleanReq(id);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async writeHeartbeat(hb) {
    const id = utils.nextId();
    const timer = this._requestTimer(id, hb);
    try {
      const p = this._waitResponse(id, hb);
      this._writeHeartbeat(id, hb);
      return await p;
    } catch (e) {
      this._cleanReq(id);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  oneway(req) {
    assert(this._encoder.writeRequest, '[Connection] encoder have not impl writeRequest');
    const id = utils.nextId();
    req.oneway = true;
    this._encoder.writeRequest(id, req, err => {
      if (err) {
        err.name = this.OneWayEncodeErrorName;
        err.resultCode = '02';
        this.emit('error', err);
      }
    });
  }

  async writeResponse(req, res) {
    assert(this._encoder.writeResponse, '[Connection] encoder have not impl writeResponse');
    return new Promise((resolve, reject) => {
      this._encoder.writeResponse(req, res, err => {
        if (!err) {
          return resolve();
        }
        err.name = this.ResponseEncodeErrorName;
        err.resultCode = '02';
        return reject(err);
      });
    });
  }

  async writeHeartbeatAck(hb) {
    assert(this._encoder.writeHeartbeatAck, '[Connection] encoder have not impl writeHeartbeatAck');
    return new Promise((resolve, reject) => {
      this._encoder.writeHeartbeatAck(hb, err => {
        if (!err) {
          return resolve();
        }
        err.name = this.ResponseEncodeErrorName;
        err.resultCode = '02';
        return reject(err);
      });
    });
  }

  _requestTimer(id, req) {
    const start = Date.now();
    return setTimeout(() => {
      const rt = Date.now() - start;
      const err = new Error('no response in ' + rt + 'ms, ' + this.url);
      err.name = this.ResponseTimeoutErrorName;
      err.resultCode = '03'; // 超时
      this._handleRequestError(id, err);
    }, req.timeout);
  }

  _writeRequest(id, req) {
    assert(this._encoder.writeRequest, '[Connection] encoder have not impl writeRequest');
    this._encoder.writeRequest(id, req, err => {
      if (err) {
        err.name = this.RequestEncodeErrorName;
        err.resultCode = '02';
        process.nextTick(() => {
          this._handleRequestError(id, err);
        });
      }
    });
  }

  _writeHeartbeat(id, hb) {
    assert(this._encoder.writeHeartbeat, '[Connection] encoder have not impl writeHeartbeat');
    this._encoder.writeHeartbeat(id, hb, err => {
      if (err) {
        err.name = this.RequestEncodeErrorName;
        err.resultCode = '02';
        process.nextTick(() => {
          this._handleRequestError(id, err);
        });
      }
    });
  }

  _waitResponse(id, req) {
    const event = 'response_' + id;
    let resReject;
    const resPromise = new Promise((resolve, reject) => {
      resReject = reject;
      this.once(event, resolve);
    });
    this._sentReqs.set(id, { req, resPromise, resReject });
    return resPromise;
  }

  async forceClose(err) {
    const closePromise = this.await('close');
    if (err) {
      this._decoder.emit('error', err);
    } else {
      this._decoder.end(() => this._decoder.destroy());
    }
    await closePromise;
  }

  async close(err) {
    if (this._userClosed) return;
    this._userClosed = true;
    const closeEvent = this.await('close');
    // await pending request done
    await Promise.all(
      Array.from(this._sentReqs.values())
        .map(data => data.resPromise)
      // catch the error, do noop, writeRequest will handle it
    ).catch(() => {});
    if (err) {
      this._decoder.emit('error', err);
    } else {
      // flush data
      this._decoder.end();
    }
    await closeEvent;
  }

  _cleanReq(id) {
    return this._sentReqs.delete(id);
  }

  _handleResponse(res) {
    const id = res.packetId;
    if (this._cleanReq(id)) {
      this.emit('response_' + id, res);
    } else {
      this.logger.warn('[Connection] can not find invoke request for response: %j, maybe it\'s timeout.', res);
    }
  }

  _handleRequestError(id, err) {
    if (!this._sentReqs.has(id)) {
      return;
    }
    const { resReject } = this._sentReqs.get(id);
    this._cleanReq(id);
    return resReject(err);
  }

  _handleClose(err) {
    if (this._closed) return;
    this._closed = true;
    if (err) {
      if (err.code === 'ECONNRESET') {
        this.logger.warn('[Connection] ECONNRESET, %s', this.url);
      } else {
        err.name = err.name === 'Error' ? this.SocketErrorName : err.name;
        err.message = err.message + ', ' + this.url;
        this.emit('error', err);
      }
    }
    this._cleanRequest(err);
    this._decoder.destroy();
    this.emit('close');
  }

  _cleanRequest(err) {
    if (!err) {
      err = new Error('The socket was closed. ' + this.url);
      err.name = this.SocketCloseError;
      err.resultCode = '02';
    }
    for (const id of this._sentReqs.keys()) {
      this._handleRequestError(id, err);
    }
  }

  get _sentReqs() {
    return this.options.sentReqs;
  }

  get protocol() {
    return this.options.protocol;
  }

  get socket() {
    return this.options.socket;
  }

  get logger() {
    return this.options.logger;
  }

  get protocolOptions() {
    return Object.assign({
      sentReqs: this._sentReqs,
    }, this.options.protocolOptions);
  }

  static defaultOptions() {
    return {
      sentReqs: new Map(),
      connectTimeout: 5000,
    };
  }
}

module.exports = Connection;
