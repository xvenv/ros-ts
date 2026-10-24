import { createServer, type Server, type Socket } from 'node:net';

import { decodeSentencesIndep, encodeSentenceIndep } from './independent-codec.js';

export interface FakeCommand {
  readonly words: readonly string[];
  readonly tag: string | undefined;
}

export class FakeRouter {
  private readonly server: Server;
  private readonly buffers = new Map<Socket, Buffer>();
  private readonly commands: FakeCommand[] = [];
  private readonly waiters: Array<(command: FakeCommand) => void> = [];
  private readonly sockets = new Set<Socket>();
  private lastSocket: Socket | undefined;

  private constructor(server: Server) {
    this.server = server;
    this.server.on('connection', (socket) => this.accept(socket));
  }

  static async start(): Promise<FakeRouter> {
    const server = createServer();
    const router = new FakeRouter(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    return router;
  }

  get port(): number {
    const address = this.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Fake router is not listening');
    }
    return address.port;
  }

  async nextCommand(): Promise<FakeCommand> {
    const command = this.commands.shift();
    if (command !== undefined) return command;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  send(words: readonly string[]): void {
    const socket = this.lastSocket;
    if (socket === undefined) throw new Error('No client connected');
    socket.write(encodeSentenceIndep(words));
  }

  sendChunks(buffer: Buffer, sizes: readonly number[]): void {
    const socket = this.lastSocket;
    if (socket === undefined) throw new Error('No client connected');
    let offset = 0;
    for (const size of sizes) {
      socket.write(buffer.subarray(offset, offset + size));
      offset += size;
    }
    socket.write(buffer.subarray(offset));
  }

  sendMany(sentences: readonly (readonly string[])[]): void {
    const socket = this.lastSocket;
    if (socket === undefined) throw new Error('No client connected');
    socket.write(Buffer.concat(sentences.map((words) => encodeSentenceIndep(words))));
  }

  destroyClient(): void {
    const socket = this.lastSocket;
    if (socket === undefined) throw new Error('No client connected');
    socket.destroy();
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private accept(socket: Socket): void {
    this.lastSocket = socket;
    this.sockets.add(socket);
    this.buffers.set(socket, Buffer.alloc(0));

    socket.on('data', (chunk) => {
      const previous = this.buffers.get(socket) ?? Buffer.alloc(0);
      const { sentences, rest } = decodeSentencesIndep(
        Buffer.concat([previous, chunk]),
      );
      this.buffers.set(socket, rest);
      for (const words of sentences) {
        const tagWord = words.find((word) => word.startsWith('.tag='));
        const command: FakeCommand = {
          words,
          tag: tagWord === undefined ? undefined : tagWord.slice(5),
        };
        const waiter = this.waiters.shift();
        if (waiter !== undefined) waiter(command);
        else this.commands.push(command);
      }
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
      this.buffers.delete(socket);
    });
  }
}
