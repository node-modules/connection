import { Socket } from 'net';
import {
  Transform,
  Writable,
  TransformOptions,
  WritableOptions,
} from 'stream';
import Base, { BaseOptions } from 'sdk-base';

export type WriteCallback = (err?: Error) => void;

export interface Request {
  timeout: number;
}

export interface Response {
}

export interface ProtocolEncoder extends Transform {
  writeRequest(id: number, req: Request, cb: WriteCallback);

  writeResponse(req: Request, res: Response, cb: WriteCallback);
}

export interface ProtocolDecoder extends Writable {
}

type ProtocolOptions = TransformOptions & WritableOptions;

export interface Protocol {
  name: string;

  encoder(protocolOptions: ProtocolOptions): ProtocolEncoder;

  decoder(protocolOptions: ProtocolOptions): ProtocolDecoder;
}

export interface ConnectionOptions extends BaseOptions {
  socket: Socket;
  logger: unknown;
  protocol: Protocol;

  protocolOptions?: ProtocolOptions;
  sendReqs?: Map<number, object>;
  url?: string;
  connectTimeout?: number;
}

export default interface Connection extends Base {
  constructor(options: ConnectionOptions);

  /**
   * write request and wait response
   * @param req
   */
  writeRequest(req: Request): Promise<Response>;

  /**
   * write heartbeat and wait heartbeatAck
   * @param hb
   */
  writeHeartbeat(hb: Request): Promise<Response>;

  /**
   * write response
   * @param res
   */
  writeResponse(res: Response): Promise<void>;

  /**
   * write heartbeatAck
   * @param hb
   */
  writeHeartbeatAck(hb: Response): Promise<void>;

  /**
   * write request and not wait response
   * @param req
   */
  oneway(req: Request);

  /**
   * close the connection and not wait inflight request
   */
  forceClose(): Promise<void>;

  /**
   * close the connection and wait inflight request
   */
  close(): Promise<void>;
}


