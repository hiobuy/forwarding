import { ShippingCalculator } from "./ShippingCalculator";
import { PageHeader } from "../../components/ui";

export function CalculatorPage() {
  return (
    <div>
      <PageHeader title="Shipping calculator" subtitle="Compare estimated freight before you ship. The final charge is set after packing." />
      <ShippingCalculator mode="customer" />
    </div>
  );
}
