/** Static English FAQ. Edit this list; there is no CMS. */

export const SITE_FAQ = [
  {
    question: "How do I use the China warehouse address when I shop?",
    answer:
      "After you register, the customer center shows the warehouse recipient, phone, province, city, district, street, and postal code, plus your member code. Put that member code in the recipient line. That is how inbound parcels are matched to your account.",
  },
  {
    question: "How does consolidation change the shipping charge?",
    answer:
      "You can combine parcels that are ready into one shipment. Freight is quoted from the packed weight and size, then charged after the warehouse finishes packing. The public calculator is an estimate only. It does not create a shipment or charge a wallet.",
  },
  {
    question: "Which kinds of goods can be shipped?",
    answer:
      "The calculator lists the cargo types this workspace can quote. Choose the type that matches the goods. Prohibited items can be refused. The exact lanes and restrictions come back with each quote, not as a fixed promise on this page.",
  },
  {
    question: "How long can a parcel stay at the warehouse?",
    answer:
      "Free storage is counted from the day the warehouse receives the parcel. The length of that window is part of the warehouse profile in your account. After it ends, storage fees can be added to the shipment bill.",
  },
  {
    question: "What if something looks wrong when the parcel arrives?",
    answer:
      "Warehouse photos are attached to the package in your account. If the warehouse marks an exception, it is shown separately from the normal status. You can ask for extra photos or checks before the parcel is shipped.",
  },
] as const;
