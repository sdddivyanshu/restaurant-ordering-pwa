-- Database-level integrity guards that Prisma's schema language cannot express.
-- These complement (never replace) the service-layer validation.

ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "loyalty_balance_non_negative" CHECK ("balance" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_amounts_non_negative"
  CHECK ("subtotalPaise" >= 0 AND "discountPaise" >= 0 AND "taxPaise" >= 0 AND "totalPaise" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "order_discount_not_above_subtotal" CHECK ("discountPaise" <= "subtotalPaise");
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_quantity_positive" CHECK ("quantity" > 0 AND "quantity" <= 100);
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "adjustment_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_item_price_non_negative" CHECK ("basePricePaise" >= 0);
ALTER TABLE "MenuItem" ADD CONSTRAINT "menu_item_spice_range" CHECK ("spiceLevel" BETWEEN 0 AND 3);
ALTER TABLE "CustomizationGroup" ADD CONSTRAINT "group_select_bounds" CHECK ("minSelect" >= 0 AND "maxSelect" >= 1 AND "minSelect" <= "maxSelect");
ALTER TABLE "TaxConfiguration" ADD CONSTRAINT "tax_rate_range" CHECK ("rateBps" BETWEEN 0 AND 10000);
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "service_request_message_length" CHECK ("message" IS NULL OR char_length("message") <= 140);
ALTER TABLE "Feedback" ADD CONSTRAINT "feedback_rating_range"
  CHECK ("overall" BETWEEN 1 AND 5 AND "food" BETWEEN 1 AND 5 AND "service" BETWEEN 1 AND 5);
ALTER TABLE "Reward" ADD CONSTRAINT "reward_points_positive" CHECK ("pointsCost" > 0);
