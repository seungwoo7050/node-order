import { ValidationPipe } from "@nestjs/common";

export const PAGE_QUERY = new ValidationPipe({ whitelist: true, transform: true });
