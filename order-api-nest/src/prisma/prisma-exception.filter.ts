import { ArgumentsHost, Catch, ConflictException, BadRequestException, NotFoundException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { Prisma } from "../generated/prisma/client.js";

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter extends BaseExceptionFilter {
  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    switch (err.code) {
      case "P2002":
        return super.catch(new ConflictException("이미 존재하는 값이다"), host);
      case "P2003":
        return super.catch(new BadRequestException("참조하는 대상이 존재하지 않는다"), host);
      case "P2025":
        return super.catch(new NotFoundException("대상을 찾을 수 없다"), host);
      default:
        return super.catch(err, host);
    }
  }
}