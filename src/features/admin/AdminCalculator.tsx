import { ShippingCalculator } from "../calculator/ShippingCalculator";
import { AdminHeader } from "./shared";

export function AdminCalculator() {
  return (
    <div>
      <AdminHeader title="Calculator" meta="Customer quote, HioBuy cost, and estimated gross profit." />
      <ShippingCalculator mode="admin" />
    </div>
  );
}
