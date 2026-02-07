import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "../auth/admin.guard.js";
import { CreateUserDto } from "./dto/create-user.dto.js";
import { UsersService } from "./users.service.js";

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
