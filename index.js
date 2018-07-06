'use strict';

const net = require('net');
const assert = require('assert');
const Base = require('sdk-base');
const awaitFirst = require('await-first');
const pump = require('pump');
const urlparse = require('url').parse;
const awaitEvent = require('await-event');
const debug = require('debug')('connection');

let id = 0;

const defaults = {
  address: '',
  encoder: null,
  decoder: null,
  heartbeatInterval: 5000,
  connectTimeout: 3000,
};
const CLOSING = Symbol('Connection#closing');

class Connection extends Base {
  /**
   * @param {Object} options - 初始化配置
   */
  constructor(options) {
    super(Object.assign({}, defaults, options, { initMethod: 'init' }));

    assert(this.options.encoder, 'encoder is required');
    assert(this.options.decoder, 'encoder is required');

    this.id = id++;
    this.name = `conn#${process.pid}.${this.id}`;
  }

  /**
   * 初始化
   */
  async init() {
    debug('%s connection init', this.id);

    this._encoder = this.options.encoder;
    this._decoder = this.options.decoder;
    this._encoder.on('error', err => this.emit('error', err));
    this._decoder.on('error', err => this.emit('error', err));
    this._decoder.on('command', command => this.emit('command', command));

    const socket = this._createSocket();
    this.stream = pump(this._encoder, socket, this._decoder);

    // 如果触发 error 事件直接报错
    await awaitFirst(this, [ 'connect', 'error' ]);
    debug('%s connection connected', this.id);
  }

  async close(err) {
    debug('%s connection close, error: %s', this.id, err);
    if (err) this.emit('error', err);

    if (this[CLOSING] === true) return;
    this[CLOSING] = true;

    try {
      await this.ready();
    } catch (err) {
      // 如果启动失败再 close 这里必然会触发
      this.emit('error', err);
    }

    this.stream.destroy();
    await awaitEvent(this, 'close');
    debug('%s connection closed', this.id);
  }

  _createSocket() {
    const addr = urlparse(this.options.address);

    const opt = {
      host: addr.hostname,
      port: addr.port,
    };
    const socket = this.socket = net.connect(opt);
    socket.setNoDelay(true);
    socket.setTimeout(this.options.connectTimeout);

    socket.once('connect', () => {
      debug('%s socket connect event', this.id);
      // 只在启动时设置连接超时
      this.socket.setTimeout(0);
      this.emit('connect');
    });

    socket.once('timeout', () => {
      debug('%s socket timeout', this.id);
      const err = new Error(`connect ${this.options.address} timeout`);
      err.name = 'ConnectionTimeoutError';
      this.close(err);
    });

    // error 后会马上触发 close，所以只需要监听一次
    socket.once('error', err => {
      debug('%s socket error event, error: %s', this.id, err);
      err.name = 'ConnectionError';
      this.emit('error', err);
    });

    socket.once('close', () => {
      debug('%s socket close event', this.id);
      this.stopHeartbeat();
      // .close 方法会等待这个事件，改成异步的
      process.nextTick(() => this.emit('close'));
    });
    return socket;
  }
}

module.exports = Connection;
