export const vasCatalog = [
  { code: "PHOTOS", name: "Additional Photos", description: "Extra warehouse photos of the parcel and contents.", estimatedFen: 800 },
  { code: "INSPECTION", name: "Open Package Inspection", description: "Warehouse opens the parcel and checks the contents.", estimatedFen: 1500 },
  { code: "QUANTITY", name: "Quantity Check", description: "Count the units against your product note.", estimatedFen: 1000 },
  { code: "REMOVE_PACKAGING", name: "Remove Seller Packaging", description: "Remove unnecessary seller boxes before consolidation.", estimatedFen: 600 },
  { code: "REINFORCE", name: "Reinforcement", description: "Add corner protection and tape.", estimatedFen: 1200 },
  { code: "REPACK", name: "Repacking", description: "Repack into a warehouse carton.", estimatedFen: 1800 },
  { code: "LABEL", name: "Labeling", description: "Apply an extra handling label.", estimatedFen: 500 },
  { code: "OTHER", name: "Other warehouse service", description: "Describe the service in your note. The warehouse will confirm the cost.", estimatedFen: 0 },
] as const;
