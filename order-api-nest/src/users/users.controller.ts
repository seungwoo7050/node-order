import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { AdminGuard } from "../auth/admin.guard.js";
import { AdminViewGuard } from "../auth/admin-view.guard.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { AdminUserQueryDto, CreateAdminUserDto, UpdateAdminUserDto } from "./dto/admin-user.dto.js";
import { UsersService } from "./users.service.js";

const userIdOf = (req: Request) => (req.user as { userId: string }).userId;

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(AuthGuard("jwt"), AdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  list() {
    return this.usersService.listWithOrders();
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}

@ApiTags("admin-users")
@ApiBearerAuth()
@Controller("admin/users")
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  list(@Query() query: AdminUserQueryDto) {
    return this.usersService.listAdminUsers(query);
  }

  @Get(":id")
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  detail(@Param("id") id: string) {
    return this.usersService.getUserDetail(id);
  }

  @Post()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  create(@Body() dto: CreateAdminUserDto) {
    return this.usersService.createAdminUser(dto);
  }

  @Patch(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  update(@Param("id") id: string, @Body() dto: UpdateAdminUserDto, @Req() req: Request) {
    return this.usersService.updateAdminUser(id, dto, userIdOf(req));
  }

  @Delete(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  remove(@Param("id") id: string, @Req() req: Request) {
    return this.usersService.deleteAdminUser(id, userIdOf(req));
  }
}

@ApiTags("admin-members")
@ApiBearerAuth()
@Controller("admin/members")
export class AdminMembersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  list(@Query() query: AdminUserQueryDto) {
    return this.usersService.listAdminUsers(query);
  }

  @Get(":id")
  @UseGuards(AuthGuard("jwt"), AdminViewGuard)
  detail(@Param("id") id: string) {
    return this.usersService.getUserDetail(id);
  }

  @Post()
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  create(@Body() dto: CreateAdminUserDto) {
    return this.usersService.createAdminUser(dto);
  }

  @Patch(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  update(@Param("id") id: string, @Body() dto: UpdateAdminUserDto, @Req() req: Request) {
    return this.usersService.updateAdminUser(id, dto, userIdOf(req));
  }

  @Delete(":id")
  @UseGuards(AuthGuard("jwt"), AdminGuard)
  remove(@Param("id") id: string, @Req() req: Request) {
    return this.usersService.deleteAdminUser(id, userIdOf(req));
  }
}
