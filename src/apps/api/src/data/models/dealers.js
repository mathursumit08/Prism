import { createModel } from "./baseModel.js";

export const Dealer = createModel({
  tableName: "dealers",
  primaryKey: "dealer_id",
  allowedFilters: {
    city: "city",
    dealerType: "dealer_type",
    region: "region",
    state: "state"
  }
});
