'use strict';

const MAX_PACKET_ID = Math.pow(2, 30); // 避免 hessian 写大整数

exports.id = 0;

exports.nextId = () => {
  exports.id += 1;
  if (exports.id >= MAX_PACKET_ID) {
    exports.id = 1;
  }
  return exports.id;
};
