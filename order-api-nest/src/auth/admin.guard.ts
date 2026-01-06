import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user;
    if (user?.role !== "admin") throw new ForbiddenException("관리자만 할 수 있습니다");
    return true;
  }
}
