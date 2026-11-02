import { Module } from "@nestjs/common";
import { AdminMembersController, AdminUsersController, UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  controllers: [UsersController, AdminUsersController, AdminMembersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
