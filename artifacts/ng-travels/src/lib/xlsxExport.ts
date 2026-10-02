import * as XLSX from "xlsx";

export interface TripExportRow {
  bookingId: string;
  startDate: string;
  customerName: string;
  customerMobile: string;
  pickup: string;
  destination: string;
  tripType: string;
  driverName?: string | null;
  mapDistanceKm: number;
  billingKm: number;
  ratePerKm: number;
  baseFare: number;
  toll: number;
  parking: number;
  permitCharge: number;
  customerTotal: number;
  totalPaid: number;
  remainingBalance: number;
  startingKm?: number | null;
  endingKm?: number | null;
  actualKm?: number | null;
  standStartKm?: number | null;
  standReturnKm?: number | null;
  standToPickupKm?: number | null;
  dropToStandKm?: number | null;
  expenseTotal?: number;
  profit?: number;
  paymentStatus: string;
  status: string;
}

export function exportTripsToXLSX(
  trips: TripExportRow[],
  filename = `NG_Travels_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
) {
  const data = trips.map((t) => ({
    "Booking ID": t.bookingId,
    "Trip Date": t.startDate,
    "Customer": t.customerName,
    "Phone": t.customerMobile,
    "Pickup": t.pickup,
    "Destination": t.destination,
    "Trip Type": t.tripType.replaceAll("_", " ").toUpperCase(),
    "Driver": t.driverName || "Unassigned",
    "Map KM": t.mapDistanceKm,
    "Billing KM": t.billingKm,
    "Rate/KM (₹)": t.ratePerKm,
    "Base Fare (₹)": t.baseFare,
    "Toll (₹)": t.toll,
    "Parking (₹)": t.parking,
    "Permit (₹)": t.permitCharge,
    "Customer Total (₹)": t.customerTotal,
    "Total Paid (₹)": t.totalPaid,
    "Balance (₹)": t.remainingBalance,
    "Start KM": t.startingKm ?? "-",
    "End KM": t.endingKm ?? "-",
    "Actual KM": t.actualKm ?? "-",
    "Stand Out KM": t.standStartKm ?? "-",
    "Stand In KM": t.standReturnKm ?? "-",
    "Stand → Pickup KM": t.standToPickupKm ?? "-",
    "Drop → Stand KM": t.dropToStandKm ?? "-",
    "Company Expenses (₹)": t.expenseTotal ?? 0,
    "Profit (₹)": t.profit ?? t.customerTotal - (t.expenseTotal ?? 0),
    "Payment Status": t.remainingBalance <= 0 ? "Fully Paid" : t.totalPaid > 0 ? "Partially Paid" : "Unpaid",
    "Trip Status": t.status.replaceAll("_", " ").toUpperCase(),
  }));

  // Create worksheet
  const ws = XLSX.utils.json_to_sheet(data);

  // Set column widths
  const colWidths = [
    { wch: 16 }, // Booking ID
    { wch: 12 }, // Date
    { wch: 22 }, // Customer
    { wch: 16 }, // Phone
    { wch: 24 }, // Pickup
    { wch: 24 }, // Destination
    { wch: 18 }, // Trip Type
    { wch: 16 }, // Driver
    { wch: 10 }, // Map KM
    { wch: 12 }, // Billing KM
    { wch: 12 }, // Rate/KM
    { wch: 14 }, // Base Fare
    { wch: 10 }, // Toll
    { wch: 10 }, // Parking
    { wch: 12 }, // Permit
    { wch: 16 }, // Total
    { wch: 14 }, // Paid
    { wch: 14 }, // Balance
    { wch: 10 }, // Start KM
    { wch: 10 }, // End KM
    { wch: 10 }, // Actual KM
    { wch: 12 }, // Stand Out KM
    { wch: 12 }, // Stand In KM
    { wch: 16 }, // Stand -> Pickup KM
    { wch: 16 }, // Drop -> Stand KM
    { wch: 16 }, // Expenses
    { wch: 14 }, // Profit
    { wch: 14 }, // Payment Status
    { wch: 14 }, // Trip Status
  ];
  ws["!cols"] = colWidths;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Operations Summary");

  // Save workbook to file
  XLSX.writeFile(wb, filename);
}
