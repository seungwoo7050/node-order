import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";

@WebSocketGateway({ cors: true })
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  handleConnection(socket: Socket) {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) { socket.disconnect(true); return; }
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!) as { sub: string };
      socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  notifyUser(userId: string, event: string, data: unknown) {
    this.server.to(`user:${userId}`).emit(event, data);
  }
}