import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

// 관리자 화면 읽기: 데모 관리자도 볼 수 있다(바꾸는 동작은 AdminGuard가 막는다)
@Injectable()
export class AdminViewGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const role = context.switchToHttp().getRequest<{ user?: { role?: string } }>().user?.role;
    if (role !== "admin" && role !== "demo_admin") throw new ForbiddenException("관리자만 볼 수 있습니다");
    return true;
  }
}
