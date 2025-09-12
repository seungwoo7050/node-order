import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { NotificationsGateway } from '../notifications/notifications.gateway.js';

export interface Order { id: number; user: string; price: number; paid: boolean; }

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  private readonly orders: Order[] = [
    { id: 101, user: "kim", price: 12000, paid: true },
    { id: 102, user: "lee", price: 8000, paid: false },
    { id: 103, user: "kim", price: 5000, paid: true },
    { id: 201, user: "lee", price: 30000, paid: true },
    { id: 202, user: "park", price: 7000, paid: true },
  ];
  private nextId = 203;

  constructor(private readonly notifications: NotificationsGateway) {}

  list(paid?: boolean): Order[] {
    return paid === undefined ? [...this.orders] : this.orders.filter((o) => o.paid === paid);
  }
  findOne(id: number): Order {
    const order = this.orders.find((o) => o.id === id);
    if (!order) throw new NotFoundException(`order ${id} not found`);
    return order;
  }
  create(input: Omit<Order, "id">, creatorId: string): Order {
    const order: Order = { id: this.nextId++, ...input };
    this.orders.push(order);
    this.logger.log(`주문 생성: #${order.id} (${order.user})`);
    this.notifications.notifyUser(creatorId, "order.created", order);
    return order;
  }
  totals(): Record<string, number> {
    return this.orders.filter((o) => o.paid).reduce<Record<string, number>>((acc, o) => {
      acc[o.user] = (acc[o.user] ?? 0) + o.price;
      return acc;
    }, {});
  }
}
