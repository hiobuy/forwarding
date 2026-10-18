import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CALLING_CODES, flagEmoji } from "../../domain/calling-codes";
import { countryName, dialFor } from "../../domain/countries";
import { ChevronDown, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, LoadingBlock, Notice, PageHeader, inputClass } from "../../components/ui";
import { useToast } from "../../components/toast";
import { ApiError, api } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { Address } from "../../types/api";

const empty = { firstName: "", lastName: "", email: "", company: "", phoneCode: "", phone: "", countryCode: "", regionCode: "", state: "", city: "", district: "", postalCode: "", addressLine1: "", addressLine2: "" };

type Destination = { code: string; name: string; dial: string; regions: { code: string; name: string }[] };

export function AddressesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<Address> | null>(null);
  const [asDefault, setAsDefault] = useState(false);
  const [countryCode, setCountryCode] = useState("");
  const [regionCode, setRegionCode] = useState("");
  const [phoneCountry, setPhoneCountry] = useState("");
  const [phone, setPhone] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["addresses"], queryFn: () => api<Address[]>("/api/addresses") });
  const destinations = useQuery({ queryKey: ["destinations"], queryFn: () => api<{ countries: Destination[] }>("/api/destinations") });
  const countries = destinations.data?.countries ?? [];
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<Address>(body.id ? `/api/addresses/${body.id}` : "/api/addresses", {
        method: body.id ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setEditing(null);
      toast({ title: "Address saved.", tone: "success" });
      save.reset();
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/addresses/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setRemoveId(null);
      toast({ title: "Address deleted.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
    },
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api(`/api/addresses/${id}/default`, { method: "POST" }),
    onSuccess: async () => {
      toast({ title: "Default address updated.", tone: "success" });
      await queryClient.invalidateQueries({ queryKey: ["addresses"] });
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      id: editing?.id,
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      email: String(form.get("email") ?? ""),
      company: String(form.get("company") ?? ""),
      phoneCode: CALLING_CODES.find((country) => country.code === phoneCountry)?.dial ?? dialFor(phoneCountry),
      phone,
      countryCode,
      regionCode,
      state: String(form.get("state") ?? ""),
      city: String(form.get("city") ?? ""),
      district: String(form.get("district") ?? "") || undefined,
      postalCode: String(form.get("postalCode") ?? ""),
      addressLine1: String(form.get("addressLine1") ?? ""),
      addressLine2: String(form.get("addressLine2") ?? "") || undefined,
      isDefault: asDefault,
    });
  }

  function chooseCountry(code: string) {
    const next = countries.find((country) => country.code === code);
    setCountryCode(code);
    setRegionCode(next?.regions[0]?.code ?? "");
    setPhoneCountry(code);
  }

  function openNew() {
    const first = countries[0];
    setAsDefault((query.data?.length ?? 0) === 0);
    setCountryCode(first?.code ?? "");
    setRegionCode(first?.regions[0]?.code ?? "");
    setPhoneCountry(first?.code ?? "");
    setPhone("");
    setEditing(empty);
  }

  function openEdit(address: Address) {
    const listed = countries.find((country) => country.code === address.countryCode);
    const region = listed?.regions.find((item) => item.code === address.regionCode) ?? listed?.regions[0];
    const phoneMatch = countries.find((country) => country.dial && country.dial === address.phoneCode) ?? listed;
    setAsDefault(address.isDefault);
    setCountryCode(address.countryCode);
    setRegionCode(region?.code ?? address.regionCode ?? "");
    setPhoneCountry(phoneMatch?.code ?? address.countryCode);
    setPhone(address.phone.replace(/\D/g, "").slice(0, 20));
    setEditing(address);
  }

  return (
    <div>
      <PageHeader
        title="Addresses"
        subtitle="International delivery addresses. The default is preselected when you consolidate."
        action={
          query.data?.length ? (
            <Button onClick={openNew}>
              <Plus size={15} aria-hidden="true" /> Add address
            </Button>
          ) : null
        }
      />
      {query.isLoading ? <LoadingBlock rows={2} /> : null}
      {query.error ? <ErrorState message="Could not load addresses." onRetry={() => void query.refetch()} /> : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={MapPin} title="No delivery addresses yet" body="Add the international address you want your parcels shipped to." action={<Button onClick={openNew}>Add address</Button>} />
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {query.data?.map((address) => (
          <Card key={address.id} className={address.isDefault ? "border-indigo-200 ring-1 ring-indigo-100" : ""}>
            <div className="flex h-full flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{address.name}</span>
                    {address.isDefault ? <span className="rounded-full bg-indigo-50 px-2 py-px text-[11px] font-medium text-indigo-700">Default</span> : null}
                  </div>
                  {address.company ? <div className="mt-0.5 text-[12px] text-slate-500">{address.company}</div> : null}
                  <div className="mt-0.5 text-[12px] text-slate-500">{countryName(address.countryCode)}</div>
                </div>
              </div>
              <p className="mt-3 flex-1 text-[13px] leading-5 text-slate-600">
                {address.addressLine1}
                {address.addressLine2 ? <>, {address.addressLine2}</> : null}
                <br />
                {[address.district, address.city, address.state].filter(Boolean).join(", ")} {address.postalCode}
                <br />
                {address.email ? <><span className="text-slate-500">{address.email}</span><br /></> : null}
                <span className="text-slate-500">{[address.phoneCode, address.phone].filter(Boolean).join(" ")}</span>
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
                <Button variant="ghost" size="sm" onClick={() => openEdit(address)}>
                  <Pencil size={13} aria-hidden="true" /> Edit
                </Button>
                {!address.isDefault ? (
                  <Button variant="ghost" size="sm" loading={makeDefault.isPending && makeDefault.variables === address.id} onClick={() => makeDefault.mutate(address.id)}>
                    Set as default
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" className="ml-auto text-slate-500 hover:bg-red-50 hover:text-red-700" onClick={() => setRemoveId(address.id)}>
                  <Trash2 size={13} aria-hidden="true" /> Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Dialog
        open={editing != null}
        title={editing?.id ? "Edit address" : asDefault ? "Add default address" : "Add address"}
        size="xl"
        spacious
        onClose={() => {
          setEditing(null);
          save.reset();
        }}
        footer={
          <>
            <Button variant="secondary" type="button" className="h-9 rounded-full px-4" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" form="address-form" className="h-9 rounded-full bg-neutral-950 px-4 shadow-none hover:bg-neutral-800" loading={save.isPending} disabled={!countryCode}>Save</Button>
          </>
        }
      >
        {editing ? (
          <form id="address-form" className="flex flex-col gap-5" onSubmit={onSubmit}>
            {countries.length === 0 ? <Notice tone="warning">No delivery countries are open yet. Turn them on in Settings, then come back.</Notice> : null}
            <Field label="Country/region">
              <SearchSelect
                label="Country/region"
                value={countryCode}
                options={countries.map((country) => ({ value: country.code, label: country.name }))}
                onChange={chooseCountry}
              />
            </Field>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="First name"><input className={cn(inputClass, "h-11 shadow-none")} name="firstName" required autoComplete="given-name" defaultValue={editing.firstName} /></Field>
              <Field label="Last name"><input className={cn(inputClass, "h-11 shadow-none")} name="lastName" required autoComplete="family-name" defaultValue={editing.lastName} /></Field>
            </div>
            <Field label="Company"><input className={cn(inputClass, "h-11 shadow-none")} name="company" autoComplete="organization" defaultValue={editing.company ?? ""} /></Field>
            <input type="hidden" name="email" value={editing.email ?? ""} />
            <Field label="Address"><input className={cn(inputClass, "h-11 shadow-none")} name="addressLine1" required autoComplete="address-line1" defaultValue={editing.addressLine1} /></Field>
            <Field label="Apartment, suite, etc"><input className={cn(inputClass, "h-11 shadow-none")} name="addressLine2" autoComplete="address-line2" defaultValue={editing.addressLine2 ?? ""} /></Field>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="City"><input className={cn(inputClass, "h-11 shadow-none")} name="city" required autoComplete="address-level2" defaultValue={editing.city} /></Field>
              <Field label="State"><input className={cn(inputClass, "h-11 shadow-none")} name="state" required autoComplete="address-level1" defaultValue={editing.state} /></Field>
              <Field label={countryCode === "US" ? "ZIP code" : "Postal code"}><input className={cn(inputClass, "h-11 shadow-none")} name="postalCode" required autoComplete="postal-code" defaultValue={editing.postalCode} /></Field>
            </div>
            <Field label="Phone">
              <PhoneField dial={CALLING_CODES.find((country) => country.code === phoneCountry)?.dial ?? dialFor(phoneCountry)} country={phoneCountry} phone={phone} onCountry={setPhoneCountry} onPhone={setPhone} />
            </Field>
            {save.error ? <Notice tone="danger">{save.error instanceof ApiError ? save.error.message : "Could not save the address."}</Notice> : null}
          </form>
        ) : null}
      </Dialog>
      <ConfirmDialog open={removeId != null} title="Delete this address?" body="Shipments you already created keep their own copy of the address." confirmLabel="Delete address" danger pending={remove.isPending} onClose={() => setRemoveId(null)} onConfirm={() => removeId && remove.mutate(removeId)} />
    </div>
  );
}

function nationalDigits(raw: string, dial: string) {
  const digits = raw.replace(/\D/g, "");
  const code = dial.replace(/\D/g, "");
  const trimmed = raw.trim();
  const pastedWithCode = code && (trimmed.startsWith("+") || trimmed.startsWith(dial)) && digits.startsWith(code);
  return (pastedWithCode ? digits.slice(code.length) : digits).slice(0, 20);
}

function PhoneField({
  dial,
  country,
  phone,
  onCountry,
  onPhone,
}: {
  dial: string;
  country: string;
  phone: string;
  onCountry: (code: string) => void;
  onPhone: (phone: string) => void;
}) {
  return (
    <div className="flex h-11 items-center rounded-lg border border-slate-200 bg-white pl-1 shadow-sm focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-100">
      <SearchSelect
        label="Calling code"
        value={country}
        buttonClassName="h-9 w-14 shrink-0 border-0 bg-transparent px-1.5 shadow-none focus:border-transparent focus:ring-0"
        formatSelected={(option) => <span className="text-base leading-none">{flagEmoji(option.value)}</span>}
        options={CALLING_CODES.map((item) => ({ value: item.code, label: `${item.name} (${item.dial})` }))}
        placement="up"
        menuWidth={320}
        onChange={onCountry}
      />
      {dial ? <span className="shrink-0 select-none pl-1 text-sm text-slate-900">{dial}</span> : null}
      <input
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-sm text-slate-900 outline-none"
        name="phone"
        required
        inputMode="numeric"
        autoComplete="tel-national"
        pattern="[0-9]{5,20}"
        aria-label="Phone number"
        value={phone}
        onChange={(event) => onPhone(nationalDigits(event.target.value, dial))}
      />
    </div>
  );
}

function SearchSelect({
  label,
  value,
  options,
  onChange,
  placeholder = "Choose",
  buttonClassName,
  formatSelected,
  placement = "down",
  menuWidth,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  buttonClassName?: string;
  formatSelected?: (option: { value: string; label: string }) => ReactNode;
  placement?: "down" | "up";
  menuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value);
  const shown = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = root.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.max(menuWidth ?? rect.width, rect.width);
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
      const gap = 6;
      if (placement === "up") setBox({ bottom: window.innerHeight - rect.top + gap, left, width });
      else setBox({ top: rect.bottom + gap, left, width });
    }
    function outside(event: MouseEvent) {
      const target = event.target as Node;
      if (root.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.(`[data-list="${listId}"]`)) return;
      setOpen(false);
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("mousedown", outside);
    };
  }, [open, listId, menuWidth, placement]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        className={cn("flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-900 shadow-sm outline-none focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100", buttonClassName)}
        onClick={() => {
          setQuery("");
          setOpen((current) => !current);
        }}
      >
        <span className={cn("truncate", !selected && "text-slate-400")}>{selected ? (formatSelected ? formatSelected(selected) : selected.label) : placeholder}</span>
        <ChevronDown className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
      </button>
      {open && box
        ? createPortal(
            <div data-list={listId} id={listId} className="fixed z-[60] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg" style={{ top: box.top, bottom: box.bottom, left: box.left, width: box.width }}>
              <div className="border-b border-slate-100 p-2">
                <input
                  className={cn(inputClass, "h-8")}
                  value={query}
                  autoFocus
                  placeholder="Search"
                  aria-label={`Search ${label}`}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setOpen(false);
                  }}
                />
              </div>
              <ul className={cn("overflow-y-auto p-1", placement === "up" ? "max-h-80" : "max-h-56")}>
                {shown.map((option) => (
                  <li key={option.value}>
                    <button
                      type="button"
                      className={cn("flex w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-indigo-50", option.value === value && "font-medium text-brand")}
                      onClick={() => {
                        onChange(option.value);
                        setOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                ))}
                {shown.length === 0 ? <li className="px-3 py-2 text-[13px] text-slate-500">No matches.</li> : null}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
