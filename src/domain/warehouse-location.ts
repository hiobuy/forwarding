export type SyncedWarehouse = {
  id: string;
  name: string;
  recipient: string;
  country: string;
  province: string;
  city: string;
  district: string;
  street: string;
  postalCode: string;
  phone: string;
  hours: string;
  /** ISO country codes this warehouse can receive for. */
  supportedDestinations: string[];
  notice: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
const DAY_LABEL: Record<(typeof DAY_ORDER)[number], string> = {
  MONDAY: "Mon",
  TUESDAY: "Tue",
  WEDNESDAY: "Wed",
  THURSDAY: "Thu",
  FRIDAY: "Fri",
  SATURDAY: "Sat",
  SUNDAY: "Sun",
};

function isDay(value: string): value is (typeof DAY_ORDER)[number] {
  return (DAY_ORDER as readonly string[]).includes(value);
}

/** Collapse identical neighboring days: Mon–Sat 09:00–24:00, Sun closed. */
function weekdaySchedule(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const slots = new Map<string, string>();
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const day = text(row.day).toUpperCase();
    if (!isDay(day)) continue;
    if (row.closed === true) {
      slots.set(day, "closed");
      continue;
    }
    const open = text(row.open);
    const close = text(row.close);
    if (!open || !close) continue;
    slots.set(day, `${open}–${close}`);
  }
  const ordered = DAY_ORDER.filter((day) => slots.has(day));
  if (!ordered.length) return "";
  const groups: { start: (typeof DAY_ORDER)[number]; end: (typeof DAY_ORDER)[number]; slot: string }[] = [];
  for (const day of ordered) {
    const slot = slots.get(day)!;
    const last = groups[groups.length - 1];
    const previous = DAY_ORDER[DAY_ORDER.indexOf(day) - 1];
    if (last && last.slot === slot && last.end === previous) last.end = day;
    else groups.push({ start: day, end: day, slot });
  }
  return groups
    .map((group) => {
      const span = group.start === group.end ? DAY_LABEL[group.start] : `${DAY_LABEL[group.start]}–${DAY_LABEL[group.end]}`;
      return group.slot === "closed" ? `${span} closed` : `${span} ${group.slot}`;
    })
    .join(", ");
}

export function hoursText(value: unknown): string {
  if (typeof value === "number") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || /^\d+$/.test(trimmed)) return "";
    return trimmed;
  }
  const record = asRecord(value);
  if (!record) return "";
  const summary = text(record.text) || text(record.summary) || text(record.label);
  if (summary && !/^\d+$/.test(summary)) return summary;
  const schedule = weekdaySchedule(record.weekdays) || weekdaySchedule(record.days);
  if (schedule) return schedule;
  const plain = text(record.hours);
  if (plain && !/^\d+$/.test(plain)) return plain;
  const timezone = text(record.timezone) || text(record.time_zone) || text(record.tz);
  if (timezone && !/^\d+$/.test(timezone)) return timezone;
  return "";
}

function countryCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const codes: string[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const raw = record ? text(record.code) || text(record.country_code) || text(record.country) : text(item);
    const code = raw.toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** China addresses read province, city, district, then the street. Skip that prefix when the street already includes it. */
export function formatWarehouseLine(input: { country: string; province: string; city: string; district: string; street: string; postalCode: string }) {
  const country = input.country.trim().toLowerCase();
  const china = country === "cn" || country === "chn" || country === "china" || country === "中国";
  const province = input.province.trim();
  const city = input.city.trim();
  const district = input.district.trim();
  const street = input.street.trim();
  const postal = input.postalCode.trim();
  if (china) {
    const prefix = `${province}${city}${district}`;
    const line = prefix && street.startsWith(prefix) ? street : [province, city, district, street].filter(Boolean).join("");
    return postal ? `${line} ${postal}` : line;
  }
  return [street, district, city, province, postal, input.country.trim()].filter(Boolean).join(", ");
}

/** Seller forms need the warehouse name and this customer's code, as `白海鸥(HX10238)`. */
export function customerReceivingLine(base: string, memberCode: string): string {
  const value = base.trim();
  const code = memberCode.trim();
  if (!code) return value;
  const mark = `(${code})`;
  if (!value) return code;
  return value.endsWith(mark) ? value : `${value}${mark}`;
}

/** Hide junk such as a bare id. A zone name is a timezone; a clock range is hours. */
export function presentSchedule(raw: string): { label: "Hours" | "Timezone"; value: string } | null {
  const value = raw.trim();
  if (!value || /^\d+$/.test(value)) return null;
  const zone = value.match(/^(?:timezone\s*[:=]\s*)?([A-Za-z]+\/[A-Za-z0-9_+-]+)$/i)?.[1];
  if (zone) return { label: "Timezone", value: zone };
  if (/^(UTC|GMT)([+-]\d{1,2}(:\d{2})?)?$/i.test(value)) return { label: "Timezone", value };
  return { label: "Hours", value };
}

function locationList(payload: unknown): unknown[] {
  const root = asRecord(payload);
  if (!root) return [];
  if (Array.isArray(root.data)) return root.data;
  const data = asRecord(root.data);
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.locations)) return data.locations;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function streetOf(row: Record<string, unknown>): string {
  const address = asRecord(row.address);
  if (!address) return text(row.address);
  return text(address.address_line) || text(address.address_line1) || text(address.line1) || text(address.detail) || text(address.street);
}

export function parseWarehouseLocations(payload: unknown): SyncedWarehouse[] {
  const rows: SyncedWarehouse[] = [];
  for (const item of locationList(payload)) {
    const row = asRecord(item);
    if (!row) continue;
    const id = text(row.id);
    const name = text(row.name);
    const street = streetOf(row);
    if (!id || !name || !street) continue;
    const address = asRecord(row.address);
    rows.push({
      id,
      name,
      recipient: text(address?.recipient) || text(row.recipient),
      country: text(row.country) || "China",
      province: text(row.province),
      city: text(row.city),
      district: text(row.district),
      street,
      postalCode: text(address?.postal_code) || text(address?.postalCode) || text(address?.zip),
      phone: text(address?.phone) || text(address?.mobile) || text(row.phone),
      hours: hoursText(row.business_hours),
      supportedDestinations: countryCodes(row.supported_destinations),
      notice: typeof row.notice === "string" && row.notice.trim() && !/^\d+$/.test(row.notice.trim()) ? row.notice.trim() : null,
    });
  }
  return rows;
}

/** Prefer a recommended warehouse that is active and still receiving. */
export function pickWarehouseLocation(payload: unknown): SyncedWarehouse | null {
  const parsed = parseWarehouseLocations(payload);
  if (!parsed.length) return null;
  const byId = new Map(parsed.map((row) => [row.id, row]));
  const ranked = locationList(payload).flatMap((item) => {
    const row = asRecord(item);
    const parsedRow = row ? byId.get(text(row.id)) : undefined;
    if (!row || !parsedRow) return [];
    const active = text(row.status) !== "INACTIVE";
    const receiving = text(row.receiving_status) !== "CLOSED" && text(row.receiving_status) !== "PAUSED";
    const recommended = row.recommended === true;
    const score = (recommended ? 4 : 0) + (active ? 2 : 0) + (receiving ? 1 : 0);
    return [{ row: parsedRow, score }];
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.row ?? parsed[0] ?? null;
}
