import { Controller, Get, Query } from "@nestjs/common";
import { AddressesService } from "./addresses.service.js";

@Controller("addresses")
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Get("search")
  search(@Query("q") query = "") {
    return this.addressesService.search(query);
  }
}
